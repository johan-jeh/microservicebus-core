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
var storage = require('node-persist');

function MicroServiceBusHost(settingsHelper) {
    var self = this;

    // Constants
    const ACCEPTEDMISSEDHEARBEATS = 3;

    // Callbacks
    this.onStarted = null;
    this.onStopped = null;
    // Handle settings
    var temporaryVerificationCode;
    var useMacAddress = false;
    var _hasDisconnected = false;
    var _shoutDown = false;
    var _firstStart = true;
    var _restoreTimeout;
    var _heartBeatInterval;
    var _lastHeartBeatReceived = true;
    var _missedHeartBeats = 0;
    var signInResponse;
    var logStream;
    var microServiceBusNode;
    var existingHostName;
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

    try {
        storage.initSync({
            dir: settingsHelper.persistDirectory,
            stringify: JSON.stringify,
            parse: JSON.parse,
            encoding: 'utf8',
            logging: false,  // can also be custom logging function 
            continuous: true, // continously persist to disk 
            interval: false, // milliseconds, persist to disk on an interval 
            ttl: false, // ttl* [NEW], can be true for 24h default or a number in MILLISECONDS 
            expiredInterval: 2 * 60 * 1000, // [NEW] every 2 minutes the process will clean-up the expired cache 
            // in some cases, you (or some other service) might add non-valid storage files to your 
            // storage dir, i.e. Google Drive, make this true if you'd like to ignore these files and not throw an error 
            forgiveParseErrors: false // [NEW] 

        }); // Used for persistent storage if off-line
    }
    catch (storageEx) {
        console.log("Local persistance is not allowed");
        storageIsEnabled = false;
    }

    var client = new signalR.client(
        settingsHelper.settings.hubUri + '/signalR',
        ['integrationHub'],
        10, //optional: retry timeout in seconds (default: 10)
        true
    );

    // Wire up signalR events
    /* istanbul ignore next */
    client.serviceHandlers = {
        bound: function () { log("Connection: " + "bound".yellow); },
        connectFailed: function (error) {
            log("Connection: " + "Connect Failed: ".red);

        },
        connected: function (connection) {
            log("Connection: " + "Connected".green);
            microServiceBusNode.settingsHelper = settingsHelper;
            microServiceBusNode.SignIn(existingHostName, temporaryVerificationCode, useMacAddress);
            //startHeartBeat();

        },
        disconnected: function () {

            log("Connection: " + "Disconnected".yellow);
            let faultDescription = 'Node has been disconnected.';
            let faultCode = '00098';
            trackException(faultCode, faultDescription);

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
        },
        connectionLost: function (error) {
            //_isWaitingForSignInResponse = false;
            log("Connection: " + "Connection Lost".red);
        },
        reconnected: void function (connection) {
            log("Connection: " + "Reconnected ".green);
        },
        reconnecting: function (retry /* { inital: true/false, count: 0} */) {
            log("Connection: " + "Retrying to connect ".yellow);
            return true;
        }
    };

    // Wire up signalR inbound events handlers
    client.on('integrationHub', 'errorMessage', function (message, errorCode) {
        OnErrorMessage(message, errorCode);
    });
    client.on('integrationHub', 'ping', function (message) {
        OnPing(message);
    });
    client.on('integrationHub', 'getEndpoints', function (message) {
        OnGetEndpoints(message);
    });
    client.on('integrationHub', 'updateItinerary', function (updatedItinerary) {
        OnUpdateItinerary(updatedItinerary);
    });
    client.on('integrationHub', 'changeState', function (state) {
        OnChangeState(state);
    });
    client.on('integrationHub', 'changeDebug', function (debug) {
        OnChangeDebug(debug);
    });
    client.on('integrationHub', 'changeTracking', function (enableTracking) {
        OnChangeTracking(enableTracking);
    });
    client.on('integrationHub', 'sendMessage', function (message, destination) {
        OnSendMessage(message, destination)
    });
    client.on('integrationHub', 'signInMessage', function (response) {
        OnSignInMessage(response);
    });
    client.on('integrationHub', 'nodeCreated', function (nodeData) {
        OnNodeCreated(nodeData);
    });
    client.on('integrationHub', 'heartBeat', function (id) {
        _lastHeartBeatReceived = true;

    });
    client.on('integrationHub', 'forceUpdate', function () {
        log("forceUpdate".red);
        restart();
    });
    client.on('integrationHub', 'restart', function () {
        log("restart".red);
        restart();
    });
    client.on('integrationHub', 'reboot', function () {
        log("reboot".red);
        reboot();
    });
    client.on('integrationHub', 'reset', function (id) {
        OnReset(id);
    });
    client.on('integrationHub', 'updateFlowState', function (itineraryId, environment, enabled) {
        OnUpdateFlowState(itineraryId, environment, enabled);
    });
    client.on('integrationHub', 'enableDebug', function (debug) {
        OnEnableDebug(debug);
    });
    client.on('integrationHub', 'reportState', function (id) {
        OnReportState(id);
    });
    client.on('integrationHub', 'loginTerminal', function (connectionId, userName, password, terminalId) {
        OnOpenTerminal(connectionId, userName, password, terminalId);
    });
    client.on('integrationHub', 'uploadSyslogs', function (connectionId, fileName, account, accountKey) {
        OnUploadSyslogs(connectionId, fileName, account, accountKey);
    });
    // Called by HUB if it was ot able to process the request
    function OnErrorMessage(message, code) {
        console.log('Error: '.red + message.red + " code: ".grey + code);

        if (code < 100) { // All exceptions less than 100 are serious and should reset settings

            let faultDescription = 'Node is being reset due to error code: ' + code + '. Message: ' + message;
            let faultCode = '00099';
            trackException(faultCode, faultDescription);

            OnReset(null);

        }
    };
    // Called by HUB when user clicks on the Hosts page
    function OnPing(id) {
        log("ping => " + microServiceBusNode.InboundServices().length + " active service(s)");

        client.invoke('integrationHub', 'pingResponse', settingsHelper.settings.nodeName, os.hostname(), "Online", id, hasTermainal());

    }
    // Called by HUB to receive all active serices
    function OnGetEndpoints(message) {
        console.log('OnGetEndpoints'.blue);
    }
    // Called by HUB when itineraries has been updated
    function OnUpdateItinerary(updatedItinerary) {
        microServiceBusNode.UpdateItinerary(updatedItinerary);

    }
    // Called by HUB when itineraries has been updated
    function OnChangeState(state) {
        microServiceBusNode.ChangeState(state);
    }
    // Called by the HUB when disabling/enabling flow
    function OnUpdateFlowState(tineraryId, environment, enabled) {
        microServiceBusNode.UpdateFlowState(tineraryId, environment, enabled);
    }
    
    // Update debug mode
    function OnChangeDebug(debug) {
        microServiceBusNode.SetDebug(debug);

    }
    // Enable remote debugging
    function OnEnableDebug(debug) {
        log("CHANGING DEBUG MODE...");
        setTimeout(function () {
            client.end();
            process.send({ cmd: 'DEBUG' });
            log('Restarting for debug'.red);
            setTimeout(function () {
                client = undefined;
                process.exit();
            }, 100);

        }, 1000);
    }
    // Enable remote debugging
    function OnChangeTracking(enableTracking) {
        microServiceBusNode.SetTracking(enableTracking);
    }
    // Incoming message from HUB
    function OnSendMessage(message, destination) {
        console.log('OnSendMessage'.blue);
    }
    // Called by HUB when signin  has been successful
    function OnSignInMessage(response) {
        log('Sign in complete...'.grey);
        response.basePath = __dirname;
        microServiceBusNode.SignInComplete(response);
    }
    // Called by HUB when node has been successfully created    
    /* istanbul ignore next */
    function OnNodeCreated(nodeData) {

        nodeData.machineName = os.hostname();

        settingsHelper.settings = extend(settingsHelper.settings, nodeData);

        log('Successfully created node: ' + nodeData.nodeName.green);

        settingsHelper.save();

        microServiceBusNode.settingsHelper = settingsHelper;
        microServiceBusNode.NodeCreated();

        client.invoke('integrationHub', 'created', nodeData.id, settingsHelper.settings.nodeName, os.hostname(), "Online", nodeData.debug, pjson.version, settingsHelper.settings.organizationId);
    }
    // Called when the hub require state information (network, storage, memory and cpu)
    function OnReportState(id) {

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
            // util.getDependanciesRecursive(function (err, list) {
            //     if (!err) {
            //         state.npmPackages = list;
            //     }
            //     else {
            //         log("Unable to get npm packages. " + err);
            //     }
            //     util.getAvailableDiskspace(function(err,storeageState){
            //         if(!err){
            //             state.storage = storeageState;
            //         }
            //         client.invoke('integrationHub', 'reportStateResponse', state, id);
            //     });
            // })
            util.getAvailableDiskspace(function (err, storeageState) {
                if (!err) {
                    state.storage = storeageState;
                }
                client.invoke('integrationHub', 'reportStateResponse', state, id);
            });
        });
    }
    // Called after user logged into the web terminal
    function OnOpenTerminal(connectionId, userName, password, terminalId) {

        client.invoke('integrationHub', 'terminalMessage', connectionId, "Checking if node is ready. please wait...", "001", terminalId);

        runSshShell(connectionId, userName, password);
    }
    // Called by HUB when node is to be resetted
    function OnReset(id) {
        log("RESETTING NODE".bgRed.white);
        var isRunningAsSnap = settingsHelper.isRunningAsSnap;
        let msbHubUri = process.env["MSBHUBURI"] ? "wss://" + process.env["MSBHUBURI"] : "wss://microservicebus.com";

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
                    log(err.grey)
                }
                else {
                    log("microservicebus-core was successfully removed".green);
                }

                if (id)
                    client.invoke('integrationHub', 'resetConfirmed', settingsHelper.settings.nodeName, id);

                // Restart
                setTimeout(function () {
                    if (isRunningAsSnap)
                        restart();
                    else
                        process.exit();
                }, 3000);
            });
        });




    }
    // 
    function OnUploadSyslogs(connectionId, f, account, accountKey) {

        const tmpPath = "/tmp/"     // MUST end with / 'slash'
        const logPath = "/var/log/" // MUST end with / 'slash'
        const filePattern = /^syslog.*|^messages.*|^system.*/

        let fileNamePrefix = new Date().toISOString().replace(/[:\.\-T]/g, '') + "-" + settingsHelper.settings.organizationId + "-" + settingsHelper.settings.nodeName + "-"
        util.addNpmPackage('azure-storage', function (err) {
            let exec = require('child_process').exec;
            if (err) {
                log("Unable to add azure-storage package." + err);
                client.invoke('integrationHub', 'notify', connectionId, "Unable to add azure-storage package." + err, "ERROR");
                return;
            }

            fs.readdir(logPath, function (err, items) {
                for (var i = 0; i < items.length; i++) {
                    // ignore non interesting log files.
                    if (!items[i].match(filePattern))
                        continue

                    const tarFileName = fileNamePrefix + items[i] + ".tar.gz"
                    const tmpFullLogFilePath = tmpPath + tarFileName
                    console.log(fileNamePrefix);

                    // GZIP=-9 for maximum compression.
                    const cmd = "GZIP=-9 tar zcvf " + tmpFullLogFilePath + " " + logPath + items[i]
                    log("Command: " + cmd)

                    exec(cmd, function (error, stdout, stderr) {

                        let exists = fs.existsSync(tmpFullLogFilePath);
                        log("FILE EXISTS:" + exists);

                        if (!exists) {
                            log("Unable to create syslog file. " + error);
                            client.invoke('integrationHub', 'notify', connectionId, "Unable to create syslog file. " + error, "ERROR");
                        }
                        else {
                            var azure = require('azure-storage');
                            var blobService = azure.createBlobService(account, accountKey);

                            blobService.createBlockBlobFromLocalFile('syslogs', tarFileName, tmpFullLogFilePath, function (error, result, response) {
                                if (error) {
                                    log("Unable to send syslog to blob storage. " + error);
                                    client.invoke('integrationHub', 'notify', connectionId, "Unable to send syslog to blob storage. " + error, "ERROR");
                                }
                                else {
                                    log(tarFileName + " saved in blob storage.");
                                    client.invoke('integrationHub', 'notify', connectionId, tarFileName + " saved in blob storage.", "INFO");
                                }
                            });
                        }
                    });
                }
            })
        });
    }

    function runSshShell(connectionId, userName, password) {
        util.addNpmPackage("node-ssh@4.2.3", true, function (err) {
            if (err) {
                client.invoke('integrationHub', 'loginResponse', connectionId, "Unable to install ssh package... sorry :(", "100", os.hostname(), terminalId);
                return;
            }
            else {
                client.invoke('integrationHub', 'loginResponse', connectionId, "All good. Let's go", "001", os.hostname(), terminalId);
                var node_ssh = require('node-ssh');
                var ssh = new node_ssh();

                ssh.connect({
                    host: os.hostname(),
                    username: userName,
                    password: password
                })
                    .then(function () {
                        client.invoke('integrationHub', 'terminalMessage', connectionId, "Successfuly logged in", "003", terminalId);
                        client.on('integrationHub', 'terminalCommand', function (connectionId, command, cwd) {

                            if (command === 'logout') {
                                client.invoke('integrationHub', 'terminalMessage', connectionId, "logged out", cwd, "004", terminalId);
                                return;
                            }

                            var result = ssh.execCommand('/bin/' + command, { cwd: cwd, stream: 'both' }).then(function (result) {
                                client.invoke('integrationHub', 'terminalMessage', connectionId, result, cwd, "004", terminalId);

                            }).catch(function (err) {
                                client.invoke('integrationHub', 'terminalMessage', connectionId, err.stack, "100", terminalId);
                            });
                        });

                    })
                    .catch(function (err) {
                        if (err.level === "client-authentication")
                            client.invoke('integrationHub', 'loginResponse', connectionId, err.stack, "101", os.hostname(), terminalId);
                        else
                            client.invoke('integrationHub', 'terminalMessage', connectionId, err.stack, "101");
                    }).catch(function () {
                        client.invoke('integrationHub', 'terminalMessage', connectionId, "Dissconncted", "007");
                        ssh.end();
                    });
            }
        });
    }

    function hasTermainal() {
        return true;
    }
    // Sends heartbeat to server every 30 sec
    function startHeartBeat() {

        if (!_heartBeatInterval) {
            log("Heartbeat started".grey);
            _heartBeatInterval = setInterval(function () {
                var lastHeartBeatId = guid.v1();

                if (!_lastHeartBeatReceived) {
                    log("MISSING HEARTBEAT".bgRed.white);
                    _missedHeartBeats++;
                    if (_missedHeartBeats > ACCEPTEDMISSEDHEARBEATS) {
                        log("UNABLE TO RESOLVE CONNECTION".bgRed.white);
                        log("TRYING TO RESTART".bgRed.white);
                        process.exit();
                    }
                }
                client.invoke(
                    'integrationHub',
                    'heartBeat',
                    lastHeartBeatId
                );
                microServiceBusNode.ServiceCountCheck();

                microServiceBusNode.RestorePersistedMessages();
                _lastHeartBeatReceived = false;
            }, 2 * 60 * 1000);
        }
    }

    // Sends location data to mSB
    function startLocationNotification() {
        if (!_locationNotification) {
            log("startLocationNotification started");
            if (_lastKnownLocation) {
                client.invoke(
                    'integrationHub',
                    'location',
                    _lastKnownLocation
                );
            }
            _locationNotification = setInterval(function () {
                if (_lastKnownLocation) {
                    log("Submitting location: " + JSON.stringify(_lastKnownLocation));
                    client.invoke(
                        'integrationHub',
                        'location',
                        _lastKnownLocation
                    );
                }
            }, _locationNotificationInterval);
        }
    }

    function log(message) {
        message = message === undefined ? "" : message;
        if (settingsHelper.settings.log && logStream) {
            logStream.write(new Date().toString() + ': ' + colors.strip(message) + '\r\n');
        }

        console.log("mSB: ".gray + message);

        if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true && client.isConnected()) {// jshint ignore:line  
            client.invoke(
                'integrationHub',
                'logMessage',
                settingsHelper.settings.nodeName,
                message,
                settingsHelper.settings.organizationId);
        }
    }

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

    //var unhook_intercept = intercept(function (message) {
    //    if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true && client.isConnected()) {// jshint ignore:line  
    //      //  client.invoke( 
    //      //      'integrationHub',
    //      //'logMessage',	
    //      //settingsHelper.settings.nodeName,
    //      //      message,
    //      //      settingsHelper.settings.organizationId);
    //    }
    //});

    // this function is called when you want the server to die gracefully
    // i.e. wait for existing connections
    /* istanbul ignore next */
    function gracefulShutdown() {
        log("bye")
        client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            client.end();
            abort();
        }, 100);

    }
    function restart() {
        log("bye")
        client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            client.end();
            setTimeout(function () {
                log('Restarting'.red);
                process.exit();
                //process.send({ chat: 'restart' });
            }, 500);
        }, 500);
    }
    function reboot() {
        log("bye")
        client.invoke('integrationHub', 'signOut', settingsHelper.settings.nodeName, os.hostname(), "Offline");
        log("Received kill signal, shutting down gracefully.");
        log(settingsHelper.settings.nodeName + ' signing out...');
        setTimeout(function () {
            client.end();
            setTimeout(function () {
                util.reboot();
            }, 500);
        }, 500);
    }
    function abort() {
        if (_debugMode)
            process.exit();
        else
            process.send({ cmd: 'abort' });
    }

    MicroServiceBusHost.prototype.Start = function (testFlag) {
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
        }

        var args = process.argv.slice(2);

        if (settingsHelper.settings.log) {
            logStream = fs.createWriteStream(settingsHelper.settings.log);
        }

        // Log in using settings
        if (settingsHelper.settings.hubUri != null && settingsHelper.settings.nodeName != null && settingsHelper.settings.organizationId != null) { // jshint ignore:line
            if (args.length > 0 && (args[0] == '/n' || args[0] == '-n')) {
                settingsHelper.settings.nodeName = args[1];
            }
            log('Logging in using settings'.grey);
        }
        // First login
        else if (args.length > 0) {
            switch (args[0]) {
                case '-w':
                case '/w':
                    useMacAddress = true;
                    break;
                case '/c':
                case '-c':
                case '-code':
                case '/code':
                    temporaryVerificationCode = args[1];

                    if (args[2] != null && args[3] != null && // jshint ignore:line
                        (args[2] == '/n' ||
                            args[2] == '-n' ||
                            args[2] == '/node' ||
                            args[2] == '-node'))
                        existingHostName = args[3];

                    break;
                default: {
                    log('Sorry, invalid arguments.'.red);
                    log('To start the host using temporary verification code, use the /code paramenter.'.yellow);
                    log('Eg: node start.js -c ABCD1234'.yellow);
                    log('');
                    log('You can also specify the node:'.yellow);
                    log('Eg: node start.js -c ABCD1234 -n nodejs00001'.yellow);
                    log('');
                    log("If you've installed the package globaly you can simplify by typing:".yellow);
                    log('Eg: nodestart -c ABCD1234 -n nodejs00001'.yellow);
                    log('');
                    if (self.onStarted)
                        self.onStarted(0, 1);

                    abort();
                    return;
                }
            }
        }
        /* istanbul ignore if */
        else {// Wrong config
            /* istanbul ignore if */
            if (temporaryVerificationCode != null) { // jshint ignore:line

            }
            else {
                if (process.argv.length != 4) {
                    log('');
                    log('Missing arguments'.red);
                    log('Make sure to start using arguments; verification code (/c) and optionally host name.'.yellow);
                    log(' If you leave out the host name, a new host will be generated for you'.yellow);
                    log('node start.js /c <Verification code> [/n <Node name>]'.yellow);
                    log('Eg: node start.js /c V5VUYFSY [/n MyHostName]'.yellow);
                    if (self.onStarted)
                        self.onStarted(0, 1);

                    process.exit(99);
                    return;
                }

                settingsHelper.settings.nodeName = process.argv[3];
                settingsHelper.settings.organizationId = process.argv[2];
                settingsHelper.settings.machineName = os.hostname();

                if (settingsHelper.settings.debug == null) // jshint ignore:line
                    settingsHelper.settings.debug = false;


                if (settingsHelper.settings.hubUri == null) // jshint ignore:line
                    settingsHelper.settings.hubUri = process.env["MSBHUBURI"] ? "wss://" + process.env["MSBHUBURI"] : "wss://microservicebus.com";


                settingsHelper.save();

                var nodeName = settingsHelper.settings.nodeName != undefined ? settingsHelper.settings.nodeName : "";
                var hubUri = settingsHelper.settings.hubUri != undefined ? settingsHelper.settings.hubUri : "";

                log('Node:           ' + nodeName.grey);
                log('Hub:            ' + hubUri.grey);
                log('');
            }
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

        microServiceBusNode = new MicroServiceBusNode(settingsHelper);
        microServiceBusNode.nodeVersion = pjson.version;
        microServiceBusNode.OnStarted(function (loadedCount, exceptionCount) {
            if (self.onStarted)
                self.onStarted(loadedCount, exceptionCount);
        });
        microServiceBusNode.OnStopped(function () {

        });
        microServiceBusNode.OnSignedIn(function (hostData) {
            hostData.npmVersion = pjson.version
            log('Signing in...'.grey);
            client.invoke(
                'integrationHub',
                'SignIn',
                hostData
            );
        });
        microServiceBusNode.OnPingResponse(function () {
            client.invoke(
                'integrationHub',
                'signedIn',
                settingsHelper.settings.nodeName,
                os.hostname(),
                "Online",
                settingsHelper.settings.organizationId,
                hasTermainal()
            );
        });
        microServiceBusNode.OnLog(function (message) {
            log(message);
        });
        microServiceBusNode.OnCreateNode(function (temporaryVerificationCode, hostPrefix, existingHostName) {
            log('Create node...'.grey);
            client.invoke(
                'integrationHub',
                'createNode',
                temporaryVerificationCode,
                hostPrefix,
                existingHostName
            );
        });
        microServiceBusNode.OnCreateNodeFromMacAddress(function (macAddress) {
            client.invoke(
                'integrationHub',
                'createNodeFromMacAddress',
                macAddress
            );
        });
        microServiceBusNode.OnUpdatedItineraryComplete(function () {
        });
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
        microServiceBusNode.OnReportLocation(function (location) {
            log('Reporting location...');
            _lastKnownLocation = location;
            startLocationNotification();

        });

        client.start();
        startHeartBeat();

        // Startig using proper config
        if (settingsHelper.settings.nodeName != null && settingsHelper.settings.organizationId != null) {
            if (temporaryVerificationCode != null)
                log('Settings has already set. Temporary verification code will be ignored.'.gray);

            settingsHelper.settings.machineName = os.hostname();
            settingsHelper.save();

            log('');
            log('Node: ' + settingsHelper.settings.nodeName.gray);
            log('Hub:  ' + settingsHelper.settings.hubUri.gray);
            log('');
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
    MicroServiceBusHost.prototype.TestOnPing = function (message) {
        try {
            OnPing(message);
        }
        catch (ex) {
            return false;
        }
        return true;
    }
    MicroServiceBusHost.prototype.TestOnChangeDebug = function (debug) {
        try {
            OnChangeDebug(debug);
        }
        catch (ex) {
            return false;
        }
        return true;
    }
    MicroServiceBusHost.prototype.TestOnUpdateItinerary = function (updatedItinerary) {
        try {
            OnUpdateItinerary(updatedItinerary);
        }
        catch (ex) {
            return false;
        }
        return true;
    }
    MicroServiceBusHost.prototype.TestOnChangeState = function (state) {
        OnChangeState(state);
        return true;
    }
}

module.exports = MicroServiceBusHost; 
