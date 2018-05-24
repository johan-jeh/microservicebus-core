/*
The MIT License (MIT)

Copyright (c) 2014 microServiceBus.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/* jshint node: true */
/* jshint esversion: 6 */
/* jshint strict:false */
'use strict';
var colors = require('colors');
var signalR = require('./signalR.js');
var moment = require('moment');
var async = require('async');
var extend = require('extend');
var reload = require('require-reload')(require);
var os = require("os");
var fs = require('fs');
var path = require('path');
var util = require('./utils.js');
var guid = require('uuid');
var pjson = require('../package.json');
var moment = require('moment');

function MicroServiceBusHost(settingsHelper) {
    var self = this;

    // Constants
    const ACCEPTEDMISSEDHEARBEATS = 3;

    // Callbacks
    this.onStarted = null;
    this.onStopped = null;
    // Handle settings
    var microServiceBusNode;
    var _temporaryVerificationCode;
    var _useMacAddress = false;
    var _client;
    var _hasDisconnected = false;
    var _shoutDown = false;
    var _firstStart = true;
    var _restoreTimeout;
    var _heartBeatInterval;
    var _heartBeatIntervalTimeout = 3 * 60 * 1000
    var _lastHeartBeatReceived = true;
    var _missedHeartBeats = 0;
    var _logStream;
    var _existingNodeName;
    var _debugMode = false;
    var _lastKnownLocation;
    var _locationNotification;
    var _locationNotificationInterval = 900000; // Report location every 15 minutes

    // Add npm path to home folder as services are otherwise not able to require them...
    // This should be added to start.js in mSB-node
    if (!settingsHelper.isRunningAsSnap) {
        var corePath = path.resolve(settingsHelper.nodePackagePath, "node_modules");
        require('app-module-path').addPath(corePath);
        require('module').globalPaths.push(corePath);
        require('module')._initPaths();
    }


    // Called by HUB if it was ot able to process the request
    /* istanbul ignore next */
    this.OnErrorMessage = function(message, code) {
        console.log('Error: '.red + message.red + " code: ".grey + code);
        if (code < 100) { // All exceptions less than 100 are serious and should reset settings

            let faultDescription = 'Node is being reset due to error code: ' + code + '. Message: ' + message;
            let faultCode = '00099';
            trackException(faultCode, faultDescription);

            self.OnReset(null);

        }
    };
    // Called by HUB when user clicks on the Hosts page
    this.OnPing = function(id) {
        log("ping => " + microServiceBusNode.InboundServices().length + " active service(s)");

        _client.invoke('integrationHub', 'pingResponse', settingsHelper.settings.nodeName, os.hostname(), "Online", id, false);

    };
    // Called by HUB to receive all active services
     /* istanbul ignore next */
    this.OnGetEndpoints = function(message) {
        console.log('OnGetEndpoints'.blue);
    };
    // Called by HUB when itineraries has been updated
    this.OnUpdateItinerary = function(updatedItinerary) {
        microServiceBusNode.UpdateItinerary(updatedItinerary);

    };
    // Called by HUB when itineraries has been updated
    this.OnChangeState = function(state) {
        microServiceBusNode.ChangeState(state);
    };
    // Called by the HUB when disabling/enabling flow
    this.OnUpdateFlowState = function(tineraryId, environment, enabled) {
        microServiceBusNode.UpdateFlowState(tineraryId, environment, enabled);
    };
    // Update debug mode
    this.OnChangeDebug = function(debug) {
        microServiceBusNode.SetDebug(debug);

    };
    // Enable remote debugging
    this.OnEnableDebug = function(connId) {
        log("CHANGING DEBUG MODE...");
        settingsHelper.settings.debugHost = connId;
        settingsHelper.save();
        // Stop SignalR
        _client.end();
        _client = undefined;

        // Send notification to parent
        process.send({ cmd: 'START-DEBUG' });

        setTimeout(function () {
            log('Restarting for debug'.yellow);
            // Kill the process
            process.exit(98);

        }, 100);
    };
    this.OnStopDebug = function() {
        log("CHANGING DEBUG MODE...");
        settingsHelper.settings.debugHost = undefined;
        settingsHelper.save();
        // Stop SignalR
        _client.end();
        _client = undefined;

        // Send notification to parent
        process.send({ cmd: 'STOP-DEBUG' });

        setTimeout(function () {
            log('Restarting for debug'.red);
            // Kill the process
            process.exit();

        }, 100);

    };
    // Enable remote debugging
    this.OnChangeTracking = function(enableTracking) {
        microServiceBusNode.SetTracking(enableTracking);
    };
    // Incoming message from HUB
    this.OnSendMessage = function(message, destination) {
        console.log(message.blue);
    };
    // Called by HUB when signin  has been successful
    this.OnSignInMessage = function(response) {
        log('Sign in complete...'.grey);
        response.basePath = __dirname;
        microServiceBusNode.SignInComplete(response);

        // Check if we're in debug mode
        if (process.execArgv.find(function (e) { return e.startsWith('--inspect'); }) !== undefined && !process.env.VSCODE_PID) {

            require('network').get_active_interface(function (err, nw) {
                let maxWidth = 75;
                let debugUri = 'http://' + nw.ip_address + ':' + process.debugPort + '/json/list';
                require("request")(debugUri, function (err, response, body) {
                    if (response.statusCode === 200) {
                        log();
                        log(util.padRight("", maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" IN DEBUG", maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" IP: " + nw.ip_address, maxWidth, ' ').bgGreen.white.bold);
                        log(util.padRight(" PORT: " + process.debugPort, maxWidth, ' ').bgGreen.white.bold);

                        let debugList = JSON.parse(body);
                        _client.invoke(
                            'integrationHub',
                            'debugResponse',
                            {
                                debugHost: settingsHelper.settings.debugHost,
                                organizationId: settingsHelper.settings.organizationId,
                                list: debugList
                            }
                        );
                    }
                    else {
                        log('Unable to receive debug data.'.red);
                    }
                });


            });
        }
    };
    // Called by HUB when node has been successfully created    
    /* istanbul ignore next */
    this.OnNodeCreated = function(nodeData) {

        nodeData.machineName = os.hostname();

        settingsHelper.settings = extend(settingsHelper.settings, nodeData);

        log('Successfully created node: ' + nodeData.nodeName.green);

        settingsHelper.save();

        microServiceBusNode.settingsHelper = settingsHelper;
        microServiceBusNode.NodeCreated();

        _client.invoke('integrationHub', 'created', nodeData.id, settingsHelper.settings.nodeName, os.hostname(), "Online", nodeData.debug, pjson.version, settingsHelper.settings.organizationId);
    };

    this.OnHeartBeat = function(id){
        log("Heartbeat received".grey);
        _lastHeartBeatReceived = true;
    };

    this.OnForceRestart = function(){
        log("forceUpdate".red);
        restart();
    };

    this.OnReboot = function(){
        log("reboot".red);
        reboot();
    };
    this.OnShutdown = function(){
        log("shutdown".red);
       shutdown();
    };
    // Called when the hub require state information (network, storage, memory and cpu)
    this.OnReportState = function(id, debugCallback) {

        let network = require('network');
        network.get_active_interface(function (err, nw) {
            //let disk = require('diskusage');
            let path = os.platform() === 'win32' ? 'c:' : '/';
            var state = {
                network: nw,
                memory: {
                    totalMem: (os.totalmem() / 1000 / 1000).toFixed(2) + ' Mb',
                    freemem: (os.freemem() / 1000 / 1000).toFixed(2) + ' Mb'
                },
                cpus: os.cpus(),
                os: os,
                env: process.env
            };
            util.getAvailableDiskspace(function (err, storeageState) {
                if (!err) {
                    state.storage = storeageState;
                }
                if (debugCallback) {
                    debugCallback(true);
                }
                else {
                    _client.invoke('integrationHub', 'reportStateResponse', state, id);
                }
            });
        });
    };
    // Called by HUB when node is to be resetted
    this.OnReset = function(id) {
        log("RESETTING NODE".bgRed.white);
        var isRunningAsSnap = settingsHelper.isRunningAsSnap;
        let msbHubUri = process.env.MSBHUBURI ? "wss://" + process.env.MSBHUBURI : "wss://microservicebus.com";

        settingsHelper.settings = {
            "debug": false,
            "hubUri": msbHubUri,
            "useEncryption": false
        };
        settingsHelper.save();

        // Stop all services
        microServiceBusNode.ForceStop(function (callback) {
            //  Remove microservicebus.core
            util.removeNpmPackage("microservicebus-core", function (err) {
                if (err) {
                    log("ERROR: Unable to remove microservicebus-core".red);
                    log(err.grey);
                }
                else {
                    log("microservicebus-core was successfully removed".green);
                }

                if (id)
                    _client.invoke('integrationHub', 'resetConfirmed', settingsHelper.settings.nodeName, id);

                // Restart
                setTimeout(function () {
                    if (isRunningAsSnap)
                        restart();
                    else
                        process.exit();
                }, 3000);
            });
        });




    };
    // Calling for syslogs from the portal
    // Logs are extracted and pushed to blob storage
    this.OnUploadSyslogs = function(connectionId, f, account, accountKey, debugCallback) {

        const tmpPath = "/tmp/";     // MUST end with / 'slash'
        const logPath = "/var/log/"; // MUST end with / 'slash'
        const filePattern = /^syslog.*|^messages.*|^system.*/;

        let fileNamePrefix = new Date().toISOString().replace(/[:\.\-T]/g, '') + "-" + settingsHelper.settings.organizationId + "-" + settingsHelper.settings.nodeName + "-";
        util.addNpmPackage('azure-storage', function (err) {
            let exec = require('child_process').exec;
            if (err) {
                log("Unable to add azure-storage package." + err);

                if (debugCallback) {
                    debugCallback(false);
                }
                else {
                    _client.invoke('integrationHub', 'notify', connectionId, "Unable to add azure-storage package." + err, "ERROR");
                }
                return;
            }

            fs.readdir(logPath, function (err, items) {
                for (var i = 0; i < items.length; i++) {
                    // ignore non interesting log files.
                    if (!items[i].match(filePattern))
                        continue;

                    const tarFileName = fileNamePrefix + items[i] + ".tar.gz";
                    const tmpFullLogFilePath = tmpPath + tarFileName;
                    console.log(fileNamePrefix);

                    // GZIP=-9 for maximum compression.
                    const cmd = "GZIP=-9 tar zcvf " + tmpFullLogFilePath + " " + logPath + items[i];
                    log("Command: " + cmd);

                    exec(cmd, function (error, stdout, stderr) {

                        let exists = fs.existsSync(tmpFullLogFilePath);
                        log("FILE EXISTS:" + exists);

                        if (!exists) {
                            log("Unable to create syslog file. " + error);
                            if (debugCallback) {
                                debugCallback(false);
                            }
                            else {
                                _client.invoke('integrationHub', 'notify', connectionId, "Unable to create syslog file. " + error, "ERROR");
                            }
                        }
                        else {
                            var azure = require('azure-storage');
                            var blobService = azure.createBlobService(account, accountKey);

                            blobService.createBlockBlobFromLocalFile('syslogs', tarFileName, tmpFullLogFilePath, function (error, result, response) {
                                if (error) {
                                    log("Unable to send syslog to blob storage. " + error);
                                    if (debugCallback) {
                                        debugCallback(false);
                                    }
                                    else {
                                        _client.invoke('integrationHub', 'notify', connectionId, "Unable to send syslog to blob storage. " + error, "ERROR");
                                    }
                                }
                                else {
                                    log(tarFileName + " saved in blob storage.");
                                    if (debugCallback) {
                                        debugCallback(true);
                                    }
                                    else {
                                        _client.invoke('integrationHub', 'notify', connectionId, tarFileName + " saved in blob storage.", "INFO");
                                    }

                                }
                            });
                        }
                    });
                }
            });
        });
    };
    // Called from portal to resubmit messages
    this.OnResendHistory = function(req) {
        microServiceBusNode.ResendHistory(new Date(req.startdate), new Date(req.enddate));
    };
    // Submitting events and alters to the portal
    this.OnRequestHistory = function(req) {
        microServiceBusNode.RequestHistory(new Date(req.startdate).getTime(), new Date(req.enddate).getTime(), req.connId);
    };
    // Resetting the host in the settings.json and restarting the node
    this.OnTransferToPrivate = function(req) {

        settingsHelper.settings = {
            "debug": false,
            "hubUri": req.hubUri,
            "useEncryption": false
        };

        settingsHelper.save();
        restart();
    };
    // Triggered when token is updated
    this.OnUpdatedToken = function(token) {
        microServiceBusNode.UpdateToken(token);
        log("Token has been updated");
    };
    
    // Sends heartbeat to server every 30 sec
    function startHeartBeat() {

        if (!_heartBeatInterval) {
            log("Heartbeat started".grey);
            _heartBeatInterval = setInterval(function () {
                var lastHeartBeatId = guid.v1();
                log("Heartbeat triggered".grey);
                if (!_lastHeartBeatReceived) {
                    log("MISSING HEARTBEAT".bgRed.white);
                    _missedHeartBeats++;
                    if (_missedHeartBeats > ACCEPTEDMISSEDHEARBEATS) {
                        log("UNABLE TO RESOLVE CONNECTION".bgRed.white);
                        log("TRYING TO RESTART".bgRed.white);
                        process.exit();
                    }
                }
                _client.invoke(
                    'integrationHub',
                    'heartBeat',
                    lastHeartBeatId
                );
                //microServiceBusNode.ServiceCountCheck();

                microServiceBusNode.RestorePersistedMessages();

                _lastHeartBeatReceived = false;
            }, _heartBeatIntervalTimeout);
        }
    }
    // Sends location data to mSB
    function startLocationNotification() {
        if (!_locationNotification) {
            log("startLocationNotification started");
            if (_lastKnownLocation) {
                _client.invoke(
                    'integrationHub',
                    'location',
                    _lastKnownLocation
                );
            }
            _locationNotification = setInterval(function () {
                if (_lastKnownLocation) {
                    log("Submitting location: " + JSON.stringify(_lastKnownLocation));
                    _client.invoke(
                        'integrationHub',
                        'location',
                        _lastKnownLocation
                    );
                }
            }, _locationNotificationInterval);
        }
    }
    // Allways logs to console and submits debug info to the portal if settings.debug === true
    function log(message, force) {
        message = message === undefined ? "" : message;

        if (settingsHelper.settings.log && _logStream) {
            _logStream.write(new Date().toString() + ': ' + colors.strip(message) + '\r\n');
        }

        console.log("mSB: ".gray + message);

        if ((settingsHelper.settings.debug || force) && _client && _client.isConnected()) {// jshint ignore:line  
            _client.invoke(
                'integrationHub',
                'logMessage',
                settingsHelper.settings.nodeName,
                message,
                settingsHelper.settings.organizationId);
        }
    }
    // submits exception data to the tracking
    function trackException(faultCode, faultDescription) {
        if (!faultCode)
            return;

        let messageBuffer = new Buffer('');
        let time = moment();
        let msg = {
            TimeStamp: time.utc().toISOString(),
            InterchangeId: guid.v1(),
            IntegrationId: '',
            IntegrationName: '',
            Environment: '',
            TrackingLevel: '',
            ItineraryId: '',
            CreatedBy: '',
            LastActivity: '',
            ContentType: '',
            Itinerary: '',
            NextActivity: null,
            Node: settingsHelper.settings.nodeName,
            OrganizationId: settingsHelper.settings.organizationId,
            MessageBuffer: null,
            _messageBuffer: messageBuffer.toString('base64'),
            IsBinary: false,
            IsLargeMessage: false,
            IsCorrelation: false,
            IsFirstAction: true,
            IsFault: true,
            IsEncrypted: false,
            Variables: [],
            FaultCode: faultCode,
            FaultDescripton: faultDescription
        };

        microServiceBusNode.TrackException(msg, null, "Fault", faultCode, faultDescription);
    }
    // Set up SignalR _client
    function setupClient() {
        _client = new signalR.client(
            settingsHelper.settings.hubUri + '/signalR',
            ['integrationHub'],
            10, //optional: retry timeout in seconds (default: 10)
            true,
            settingsHelper
        );

        // Wire up signalR events
        /* istanbul ignore next */
        _client.serviceHandlers = {
            bound: function () { log("Connection: " + "bound".yellow); },
            connectFailed: function (error) {
                log("Connection: " + "Connect Failed: ".red);

            },
            connected: function (connection) {
                log("Connection: " + "Connected".green);
                microServiceBusNode.settingsHelper = settingsHelper;
                microServiceBusNode.SignIn(_existingNodeName, _temporaryVerificationCode, _useMacAddress);
                microServiceBusNode.ReportEvent("Connected to mSB.com");
                startHeartBeat();

            },
            disconnected: function () {

                log("Connection: " + "Disconnected".yellow);
                let faultDescription = 'Node has been disconnected.';
                let faultCode = '00098';
                trackException(faultCode, faultDescription);
                microServiceBusNode.ReportEvent("Disconnected from mSB.com");

                clearTimeout(_restoreTimeout);
            },
            onerror: function (error) {
                log("Connection: " + "Error: ".red, error);
                let faultDescription = error;
                let faultCode = '00097';
                trackException(faultCode, faultDescription);

                try {
                    if (error.endsWith("does not exist for the organization")) {
                        if (self.onStarted)
                            self.onStarted(0, 1);
                    }
                }
                catch (e) { }
            },
            messageReceived: function (message) {

            },
            bindingError: function (error) {
                log("Connection: " + "Binding Error: ".red, error);
                startHeartBeat();
            },
            connectionLost: function (error) {
                log("Connection: " + "Connection Lost".red);
            },
            reconnected: function (connection) {
                log("Connection: " + "Reconnected ".green);
            },
            reconnecting: function (retry /* { inital: true/false, count: 0} */) {
                log("Connection: " + "Retrying to connect ".yellow);
                return true;
            }
        };

        // Wire up signalR inbound events handlers
        _client.on('integrationHub', 'errorMessage', function (message, errorCode) {
            self.OnErrorMessage(message, errorCode);
        });
        _client.on('integrationHub', 'ping', function (message) {
            self.OnPing(message);
        });
        _client.on('integrationHub', 'getEndpoints', function (message) {
            self.OnGetEndpoints(message);
        });
        _client.on('integrationHub', 'updateItinerary', function (updatedItinerary) {
            self.OnUpdateItinerary(updatedItinerary);
        });
        _client.on('integrationHub', 'changeState', function (state) {
            self.OnChangeState(state);
        });
        _client.on('integrationHub', 'changeDebug', function (debug) {
            self.OnChangeDebug(debug);
        });
        _client.on('integrationHub', 'changeTracking', function (enableTracking) {
            self.OnChangeTracking(enableTracking);
        });
        _client.on('integrationHub', 'sendMessage', function (message, destination) {
            self.OnSendMessage(message, destination);
        });
        _client.on('integrationHub', 'signInMessage', function (response) {
            self.OnSignInMessage(response);
        });
        _client.on('integrationHub', 'nodeCreated', function (nodeData) {
            self.OnNodeCreated(nodeData);
        });
        _client.on('integrationHub', 'heartBeat', function (id) {
            self.OnHeartBeat(id);
        });
        _client.on('integrationHub', 'forceUpdate', function () {
            self.OnForceRestart();
        });
        _client.on('integrationHub', 'restart', function () {
            self.OnForceRestart();
        });
        _client.on('integrationHub', 'reboot', function () {
            self.OnReboot();
        });
        _client.on('integrationHub', 'shutdown', function () {
            self.OnShutdown();
        });
        _client.on('integrationHub', 'reset', function (id) {
            self.OnReset(id);
        });
        _client.on('integrationHub', 'updateFlowState', function (itineraryId, environment, enabled) {
            self.OnUpdateFlowState(itineraryId, environment, enabled);
        });
        _client.on('integrationHub', 'enableDebug', function (connId) {
            self.OnEnableDebug(connId);
        });
        _client.on('integrationHub', 'stopDebug', function (connId) {
            self.OnStopDebug();
        });
        _client.on('integrationHub', 'reportState', function (id) {
            self.OnReportState(id);
        });
        _client.on('integrationHub', 'uploadSyslogs', function (connectionId, fileName, account, accountKey) {
            self.OnUploadSyslogs(connectionId, fileName, account, accountKey);
        });
        _client.on('integrationHub', 'resendHistory', function (req) {
            self.OnResendHistory(req);
        });
        _client.on('integrationHub', 'requestHistory', function (req) {
            self.OnRequestHistory(req);
        });
        _client.on('integrationHub', 'transferToPrivate', function (req) {
            self.OnTransferToPrivate(req);
        });
        _client.on('integrationHub', 'updatedToken', function (token) {
            self.OnUpdatedToken(token);
        });
    }

    // this function is called when you want the server to die gracefully
    // i.e. wait for existing connections
    /* istanbul ignore next */
    function gracefulShutdown() {
        log("bye");
        _client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            _client.end();
            process.exit(99);
        }, 100);

    }
    /* istanbul ignore next */
    function restart() {
        log("bye");
        _client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            _client.end();
            setTimeout(function () {
                log('Restarting'.red);
                process.exit();
                //process.send({ chat: 'restart' });
            }, 500);
        }, 500);
    }
    /* istanbul ignore next */
    function shutdown() {
        log("bye");
        _client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            _client.end();
            setTimeout(function () {
                util.shutdown();
            }, 500);
        }, 500);
    }
    /* istanbul ignore next */
    function reboot() {
        log("bye");
        _client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            _client.end();
            setTimeout(function () {
                util.reboot();
            }, 500);
        }, 500);
    }
    /* istanbul ignore next */
    function abort() {
        if (_debugMode)
            process.exit();
        else
            process.exit(99);//process.send('abort');
    }
 
    MicroServiceBusHost.prototype.Start = function (testFlag) {
        try {
            util.displayAnsiiLogo();

            if (testFlag) {
                _debugMode = true;
            }
            else {
                // listen for TERM signal .e.g. kill 
                process.on('SIGTERM', function (x) {
                    gracefulShutdown();
                });

                // listen for INT signal e.g. Ctrl-C
                process.on('SIGINT', function (x) {
                    gracefulShutdown();
                });

                process.on('uncaughtException', function (err) {
                    /* istanbul ignore next */
                    if (err.errno === 'EADDRINUSE' || err.errno === 'EACCES') {
                        log("");
                        log("Error: ".red + "The address is in use. Either close the program is using the same port, or change the port of the node in the portal.".yellow);
                    }
                    else if (err.message == 'gracefulShutdown is not defined') {
                        gracefulShutdown();
                    }
                    else if (err.message == 'Error: channel closed') {
                        gracefulShutdown();
                    }
                    else
                        log('Uncaught exception: '.red + err);
                });

                process.on('unhandledRejection', err => {
                    log("SERIOUS ERROR: Caught unhandledRejection", true);
                    if (err && typeof (err) === 'object') {
                        log(JSON.stringify(err), true);
                    }
                    else {
                        log(err, true);
                    }
                });
            }

            var args = process.argv.slice(2);

            if (settingsHelper.settings.log) {
                _logStream = fs.createWriteStream(settingsHelper.settings.log);
            }
            let showError = function () {
                log('Sorry, missing arguments :('.red);
                log('To start the node using temporary verification code, use the /code paramenter.'.yellow);
                log('Visit https://microServiceBus.com/nodes to generate a code.'.yellow);
                log('');
                log('Eg: node start -c ABCD1234 -n node00001'.yellow);
                log('');
                log("If you're using a private- or self hosted instance of microsServiceBus.com".yellow);
                log('  you should use the /env parameter git the instance:'.yellow);
                log('Eg: node start -c ABCD1234 -n node00001 -env myorg.microservicebus.com'.yellow);
                log('');
                log('There are many other ways to provition your nodes, such as through white listing '.grey);
                log('  MAC addresses or through integration with Cisco Jasper'.grey);
                log('');


                if (self.onStarted) {
                    self.onStarted(0, 1);
                }
                process.send({ cmd: 'SHUTDOWN' });
                //process.exit(99);
            };
            // Log in using settings
            if (settingsHelper.settings.hubUri && settingsHelper.settings.nodeName && settingsHelper.settings.organizationId) { // jshint ignore:line
                if (args.length > 0 && (args[0] == '/n' || args[0] == '-n')) {
                    settingsHelper.settings.nodeName = args[1];
                }
                log('Logging in using settings'.grey);
            }
            // First login
            else if (args.length > 0) {
                for (let index = 0; index < args.length; index++) {

                    var arg = args[index];
                    switch (arg) {
                        case '-w':
                        case '/w':
                            _useMacAddress = true;
                            break;
                        case '/c':
                        case '-c':
                        case '-code':
                        case '/code':
                            if (!args[index + 1] || args[index + 1].startsWith('-'))
                                showError();
                            _temporaryVerificationCode = args[index + 1];
                            index++;
                            break;
                        case '/n':
                        case '-n':
                            if (!args[index + 1] || args[index + 1].startsWith('-'))
                                showError();
                            _existingNodeName = args[index + 1];
                            index++;
                            break;
                        case '/env':
                        case '-env':
                            if (!args[index + 1] || args[index + 1].startsWith('-'))
                                showError();
                            settingsHelper.settings.hubUri = 'wss://' + args[index + 1];
                            settingsHelper.save();
                            index++;
                            break;
                        case '--beta':
                            break;
                        default: {
                            showError();
                            return;
                        }
                    }

                }
            }
            else {
                showError();
                return;
            }
            if (typeof String.prototype.startsWith != 'function') {
                // see below for better implementation!
                String.prototype.startsWith = function (str) {
                    return this.indexOf(str) === 0;
                };
            }
            // Only used for localhost
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

            // Load microservicebus-core
            var MicroServiceBusNode = require("./MicroServiceBusNode.js");

            microServiceBusNode = new MicroServiceBusNode(settingsHelper, this);
            microServiceBusNode.nodeVersion = pjson.version;
            microServiceBusNode.OnStarted(function (loadedCount, exceptionCount) {
                if (self.onStarted)
                    self.onStarted(loadedCount, exceptionCount);
            });
            microServiceBusNode.OnStopped(function () {
            });
            microServiceBusNode.OnSignedIn(function (hostData) {
                hostData.npmVersion = pjson.version;
                log('Hub: ' + settingsHelper.settings.hubUri.green);
                log('Node: ' + settingsHelper.settings.nodeName.green);

                log('Signing in...'.grey);
                _client.invoke(
                    'integrationHub',
                    'SignIn',
                    hostData
                );
            });
            microServiceBusNode.OnPingResponse(function () {
                _client.invoke(
                    'integrationHub',
                    'signedIn',
                    settingsHelper.settings.nodeName,
                    os.hostname(),
                    "Online",
                    settingsHelper.settings.organizationId,
                    false
                );
            });
            microServiceBusNode.OnLog(function (message, force) {
                log(message, force);
            });
            microServiceBusNode.OnCreateNode(function (_temporaryVerificationCode, hostPrefix, _existingNodeName) {
                log('Create node...'.grey);
                _client.invoke(
                    'integrationHub',
                    'createNode',
                    _temporaryVerificationCode,
                    hostPrefix,
                    _existingNodeName
                );
            });
            microServiceBusNode.OnCreateNodeFromMacAddress(function (macAddress) {
                _client.invoke(
                    'integrationHub',
                    'createNodeFromMacAddress',
                    macAddress
                );
            });
            microServiceBusNode.OnUpdatedItineraryComplete(function () {
            });
            /* istanbul ignore next */
            microServiceBusNode.OnAction(function (message) {
                log('Action received: '.grey + message.action);
                switch (message.action) {
                    case "restart":
                        log("restart".red);
                        restart();
                        return;
                    case "reboot":
                        log("reboot".red);
                        reboot();
                        return;
                    default:
                        log("Unsupported action");
                        break;
                }
            });
            /* istanbul ignore next */
            microServiceBusNode.OnReportLocation(function (location) {
                log('Reporting location...');
                _lastKnownLocation = location;
                startLocationNotification();

            });
            microServiceBusNode.OnRequestHistory(function (historyData) {
                log('sending history data...');
                _client.invoke(
                    'integrationHub',
                    'requestHistoryDataResponse',
                    historyData
                );
            });

            setupClient();
            _client.start();
            //startHeartBeat();

            // Startig using proper config
            if (settingsHelper.settings.nodeName != null && settingsHelper.settings.organizationId != null) {
                if (_temporaryVerificationCode != null)
                    log('Settings has already set. Temporary verification code will be ignored.'.gray);

                settingsHelper.settings.machineName = os.hostname();
                settingsHelper.save();
            }
        }
        catch (err) {
            log("Unable to start".red);
            log("ERROR:".red + err);
        }
    };
    MicroServiceBusHost.prototype.OnStarted = function (callback) {
        this.onStarted = callback;
    };
    MicroServiceBusHost.prototype.OnStopped = function (callback) {
        this.onStopped = callback;
    };
    MicroServiceBusHost.prototype.OnUpdatedItineraryComplete = function (callback) {
        this.onUpdatedItineraryComplete = callback;
    };

    // Test methods
    MicroServiceBusHost.prototype.SetTestParameters = function (message) {
        _heartBeatIntervalTimeout = 10000;
    };
    MicroServiceBusHost.prototype.TestOnPing = function (message) {
        try {
            self.OnPing(message);
        }
        catch (ex) {
            return false;
        }
        return true;
    };
    MicroServiceBusHost.prototype.TestOnChangeTracking = function (callback) {
        try {
            self.OnChangeTracking(true);
            setTimeout(() => {
                callback(settingsHelper.settings.enableTracking);
            }, 200);
        }
        catch (ex) {
            callback(false);;
        }
    };
    MicroServiceBusHost.prototype.TestOnReportState = function (callback) {
        try {
            self.OnReportState("11234", function (success) {
                callback(success);
            });
        }
        catch (ex) {
            callback(false);;
        }
    };
    MicroServiceBusHost.prototype.TestOnUploadSyslogs = function (callback) {
        try {
            if (os.platform() === 'win32' || os.platform() === 'win64') { 
                callback(true);
            }
            else {
                self.OnUploadSyslogs('1234', "", "microservicebusstorage", "poSL/pkag8TiKLVNmFvPyNbVQe2koRujwYF91fK9XqkKX0tSwSXqZnGqSswu0QV4IyJBibWk7ZFmNeHFTMCu1g==", function (success) {
                    callback(success);
                });
            }
        }
        catch (ex) {
            callback(false);
        }
        return true;
    };
    MicroServiceBusHost.prototype.TestOnChangeDebug = function (callback) {
        
        try {
            self.OnChangeDebug(true);
            setTimeout(() => {
                callback(settingsHelper.settings.debug);
            }, 200);
        }
        catch (ex) {
            callback(false);
        }
    };
    MicroServiceBusHost.prototype.TestOnUpdateItinerary = function (updatedItinerary) {
        try {
            self.OnUpdateItinerary(updatedItinerary);
        }
        catch (ex) {
            return false;
        }
        return true;
    };
    MicroServiceBusHost.prototype.TestOnChangeState = function (state) {
        self.OnChangeState(state);
        return true;
    };
    MicroServiceBusHost.prototype.TestStop = function (state) {
        //this.onStopped();
        gracefulShutdown();
    };
}

module.exports = MicroServiceBusHost; 
