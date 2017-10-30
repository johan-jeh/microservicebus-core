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
var extend = require('extend');
var guid = require('uuid');
var npm = require('npm');
var os = require('os');
//var linq = require('node-linq').LINQ;
var fs = require('graceful-fs');
var path = require("path");
var util = require('../utils.js');
//var npmFolder = process.arch == 'mipsel' ? '/mnt/sda1' : __dirname + "/../../../";
var npmFolder = path.resolve(os.userInfo().homedir, 'node_module');

function MicroService(microService) {
    this.settingsHelper = "Not set";
    this.NodeName = "Not set";
    this.Name = "Not set";
    this.OrganizationId = "Not set";
    this.IntegrationId = "Not set";
    this.IntegrationName = "Not set";
    this.Environment = "Not set";
    this.ItineraryId = "Not set";
    this.Itinerary = "Not set";
    this.Config = { "general": {}, "static": {}, "security": {} };
    this.IsEnabled = "Not set";
    this.UseEncryption = false;
    this.App = null; // Used for Azure API Apps

    this.RunInboundScript = "Not set";
    this.RunOutboundScript = "Not set";
    this.RunScript = "Not set";
    this.ValidateRoutingExpression = "Not set";
    this.ComSettings = null;

    // Callbacks
    this.onMessageReceivedCallback = null;
    this.onReceivedStateCallback = null;
    this.onCompletedCallback = null;
    this.onErrorCallback = null;
    this.onDebugCallback = null;
    this.onThrowErrorCallback = null;
    this.onReceivedLocationCallback = null;

    MicroService.prototype.Start = function () {
        console.log("microserviceBus::Started - NOT IMPLEMENTED!");
    };

    MicroService.prototype.Stop = function () {
        console.log("microserviceBus::Started - NOT IMPLEMENTED!");
    };

    MicroService.prototype.Process = function (message, context) {
        console.log("microserviceBus::Process - NOT IMPLEMENTED!");
    };

    // Callback for messages going back to the host 
    MicroService.prototype.OnMessageReceived = function (callback) {
        this.onMessageReceivedCallback = callback;
    };
    // Callback for messages going back to the host 
    MicroService.prototype.OnReceivedState = function (callback) {
        this.onReceivedStateCallback = callback;
    };
    // Callback indicating the outbound message has been processed.
    MicroService.prototype.OnCompleted = function (callback) {
        this.onCompletedCallback = callback;
    };
    // [Depricated] Callback for errors 
    MicroService.prototype.OnError = function (callback) {
        this.onErrorCallback = callback;
    };
    // Callback for debug information
    MicroService.prototype.OnDebug = function (callback) {
        this.onDebugCallback = callback;
    };
    // Callback for Report location
    MicroService.prototype.OnReportLocation = function (callback) {
        this.onReceivedLocationCallback = callback;
    };

    // Submits message back to the host
    MicroService.prototype.SubmitMessage = function (payload, contentType, varaiables) {

        var messageBuffer;
        var isBinary = false;
        switch (contentType) {
            case 'application/json':
                if (typeof payload == 'object')
                    payload = JSON.stringify(payload);

                messageBuffer = new Buffer(payload);//.toString('base64');
                break;
            case 'application/xml':
            case 'text/plain':
                messageBuffer = new Buffer(payload);//.toString('base64');
            default:
                isBinary = true;
                var base64string = payload.toString('base64');
                messageBuffer = new Buffer(base64string);//.toString('base64');
                break;
        }

        var integrationMessage = this.CreateMessage(messageBuffer, contentType, varaiables, isBinary);

        this.onMessageReceivedCallback(integrationMessage, this);
    };
    // Submits state message back to the host 
    MicroService.prototype.SubmitState = function (state) {

        this.onReceivedStateCallback(state, this.Name);
    };

    // Submits reponse message back to host
    MicroService.prototype.SubmitResponseMessage = function (payload, context, contentType) {

        var isBinary = false;
        var messageBuffer;
        switch (contentType) {
            case 'application/json':
                payload = JSON.stringify(payload);
                messageBuffer = new Buffer(payload);//.toString('base64');
                break;
            case 'application/xml':
            case 'text/plain':
                messageBuffer = new Buffer(payload);//.toString('base64');
                break;
            default:
                messageBuffer = payload;
                isBinary = true;
                break;
        }

        var integrationMessage = {
            InterchangeId: context.InterchangeId,
            IntegrationId: context.IntegrationId,
            ItineraryId: context.ItineraryId,
            CreatedBy: context.CreatedBy,
            LastActivity: this.Name,
            ContentType: contentType,
            Itinerary: context.Itinerary,
            MessageBuffer: messageBuffer,
            _messageBuffer: messageBuffer,
            IsBinary: isBinary,
            IsLargeMessage: false,
            IsCorrelation: false,
            IsFirstAction: false,
            Variables: context.Variables
        };

        this.onMessageReceivedCallback(integrationMessage, this);
    };

    // Call indicating the outbound message has been processed.
    MicroService.prototype.Done = function (integrationMessage, destination) {
        this.onCompletedCallback(integrationMessage, destination);
    };

    MicroService.prototype.ReportLocation = function (location) {
        if (this.onReceivedLocationCallback)
            this.onReceivedLocationCallback(location);
    };

    /* istanbul ignore next */
    MicroService.prototype.CorrelationValue = function (messageString, message) {
        var correlationNode = this.Config.general.correlationId;// new linq(this.Config.generalConfig).First(function (c) { return c.id === 'correlationId'; });
        if (correlationNode != null &&
            correlationNode.value != null &&
            correlationNode.value != '' && message.ContentType == 'application/json') {

            var correlationValue = correlationNode.value;

            if (messageString == null) {
                var buf = new Buffer(message._messageBuffer, 'base64');
                messageString = buf.toString('utf8');
            }

            if (correlationNode.value.startsWith('{') || correlationNode.value.startsWith('[')) {
                correlationValue = this.ParseString(correlationNode.value, messageString, message);
            }

            this.Debug('Correlation value set (' + correlationValue + ')');

            return correlationValue;
        }
        else {
            return null;
        }
    };
    /* istanbul ignore next */
    MicroService.prototype.Error = function (source, errorId, errorDescription) {
        this.onErrorCallback(source, errorId, errorDescription);
    };

    MicroService.prototype.ThrowError = function (originalMessage, errorId, errorDescription) {
        if (originalMessage == null) { // Inbound service
            var messageBuffer = new Buffer('').toString('base64');
            originalMessage = this.CreateMessage(messageBuffer, 'text/plain', [], false);
            originalMessage.IsFirstAction = true;
        }
        originalMessage.LastActivity = this.Name;
        originalMessage.FaultCode = errorId;
        originalMessage.FaultDescripton = errorDescription;
        this.onMessageReceivedCallback(originalMessage, this);
    };

    MicroService.prototype.Debug = function (info) {
        this.onDebugCallback(this.Name, info);
    };

    MicroService.prototype.ReportLocation = function (location) {
        if (this.onReceivedLocationCallback)
            this.onReceivedLocationCallback(location);
    };

    MicroService.prototype.AddNpmPackage = function (npmPackages, logOutput, callback) {

        util.addNpmPackages(npmPackages, logOutput, callback);
    };

    MicroService.prototype.ParseString = function (str, payload, context) {
        try {
            // Parse with context '{}'
            var match;
            var regstr = str;
            var pattern = /\{(.*?)\}/g;

            while ((match = pattern.exec(str)) != null) {
                var variable = context.Variables.find(function (v) { return v.Variable === match[1]; });
                if (variable != null) {
                    regstr = regstr.replace('{' + match[1] + '}', variable.Value);
                    // return str;
                }
            }

            if (context.ContentType != 'application/json') {
                return str;
            }

            if (context.ContentType == 'application/json' && typeof payload == "object") {
                payload = JSON.stringify(payload);
            }

            // Parse with payload '[]'
            pattern = /\[(.*?)\]/g;

            while ((match = pattern.exec(regstr)) != null) {
                var someStr = "";
                var expression = "var message = " + payload + ";\nsomeStr = message." + match[1] + ";";
                eval(expression);
                regstr = regstr.replace('[' + match[1] + ']', someStr);

                //return str;
            }
            return regstr;
        }
        catch (ex) {
            throw ex;
        }
    };

    MicroService.prototype.Compile = function (tarUri, addonName, done) {
        let async = require("async");
        let settingsHelper = this.settingsHelper;
        async.waterfall([
            // Create folder
            function (callback) {
                try {
                    var addonsDirectory = path.resolve(settingsHelper.homeDirectory, "addons");

                    // Create addOn directory
                    if (!fs.existsSync(addonsDirectory)) {
                        console.log('Create directory: ' + addonsDirectory);
                        fs.mkdirSync(addonsDirectory);
                    }

                    var directory = path.resolve(addonsDirectory, addonName);

                    // Create addOn directory
                    if (!fs.existsSync(directory)) {
                        console.log('Create directory: ' + directory);
                        fs.mkdirSync(directory);
                    }
                    // else{
                    //     done();
                    //     return;
                    // }
                    callback(null, directory);
                }
                catch (err) {
                    console.log('Unable to create addons directory');
                    callback(err);
                }
            },
            // Download tar file
            function (directory, callback) {
                let requestSettings = {
                    method: 'GET',
                    url: tarUri,
                    encoding: null
                };
                require("request")(requestSettings, function (err, response, scriptContent) {
                    if (response.statusCode != 200 || err != null) {
                        callback("Unable to get dependancy file:" + dependancyFileName);
                    }
                    else {
                        try {
                            var localFilePath = path.resolve(directory, addonName + ".tar");
                            console.log('Saving addon file: ' + localFilePath);
                            fs.writeFileSync(localFilePath, scriptContent);
                            callback(null, directory, localFilePath);
                        }
                        catch (err) {
                            console.log('Unable to save addons file');
                            callback(err);
                        }
                    }
                });
            },
            // Extract
            function (directory, localFilePath, callback) {
                util.addNpmPackages("tar@4.0.2", false, function (err) {
                    if (err) {
                        console.log('Unable to add tar npm pkg');
                        callback(err);
                    }
                    else {
                        let tar = require('tar');
                        tar.x(  // or tar.extract(
                            {
                                cwd: directory,
                                file: localFilePath
                            }
                        ).then(function () {
                            callback(null, directory);

                        });
                    }
                });
            },
            // Create gyp file
            function (directory, callback) {
                let target = {
                    target_name: addonName,
                    sources: []
                };

                fs.readdir(directory, function (err, files) {
                    async.forEach(files, function (file, done2) {
                        target.sources.push(file);
                        done2();
                    }, function (err) {
                        let bindingGyp = {
                            targets: [target]
                        };

                        if (bindingGyp.targets.length) {
                            // Create binding file
                            fs.writeFileSync(path.resolve(directory, "binding.gyp"), JSON.stringify(bindingGyp));
                            // Create package file
                            fs.writeFileSync(path.resolve(directory, "package.json"), '{"name":"microServiceBus-addons","version":"1.0.0","description":"...","dependencies":{},"devDependencies":{},"scripts":{},"author":"","license":"MIT","repository":{},"config":{"unsafe-perm":true},"gypfile":true}');
                            // BUILD
                            callback(null, directory);
                        }
                    });

                });
            },
            // Build
            function (directory, callback) {
                console.log('Compiling addon...');
                util.compile(directory, function (err, data) {
                    console.log('Done compiling...');
                    if (err) {
                        console.log('Unable to compile service.'.red);
                        console.log('ERROR: '.red + err);
                        callback(err);
                    }
                    else {
                        console.log('Service compiled successfully'.green);
                        console.log('Response : ' + JSON.stringify(data));
                        callback(null, directory);
                    }
                });
            },
        ], 
        function (err, directory) {
            if (!err) {
                let npmpath = path.resolve(directory, "build/Release/", addonName);
                done(null, npmpath);
            }
            else {
                done(err);
            }
        });
    }
    // Internal
    MicroService.prototype.CreateMessage = function (messageBuffer, contentType, variables, isBinary) {

        // clone itinerary
        var json = JSON.stringify(this.Itinerary);
        var itinerary = JSON.parse(json);

        if (variables != null && itinerary.variables != null)
            variables = itinerary.variables.concat(variables);

        itinerary.variables = variables;

        var integrationMessage = {
            InterchangeId: guid.v1(),
            IntegrationId: this.IntegrationId,
            IntegrationName: this.IntegrationName,
            Environment: this.Environment,
            TrackingLevel: this.TrackingLevel,
            ItineraryId: this.ItineraryId,
            CreatedBy: this.Name,
            LastActivity: this.Name,
            ContentType: contentType,
            Itinerary: itinerary,
            MessageBuffer: null,//messageBuffer.toString('base64'),
            _messageBuffer: messageBuffer.toString('base64'),
            IsBinary: isBinary,
            IsLargeMessage: false,
            IsCorrelation: false,
            IsFirstAction: true,
            Variables: variables
        };

        return integrationMessage;
    };
    /* istanbul ignore next */
    MicroService.prototype.GetPropertyValue_OLD = function (category, prop) {
        var cat;
        switch (category) {
            case 'general':
                cat = this.Config.generalConfig;
                break;
            case 'static':
                cat = this.Config.staticConfig;
                break;
            case 'security':
                cat = this.Config.securityConfig;
                break;
            default:
                throw 'Unsuported category';
        }
        try {
            var property = cat.find(function (c) { return c.id === prop; });
        }
        catch (e) {
            throw "Property " + prop + " of category " + category + " not found in service setup configuration.";
        }
        if (property == undefined)
            throw "Property " + prop + " of category " + category + " not found in service setup configuration.";

        return property.value;
    }

    MicroService.prototype.GetPropertyValue = function (category, prop) {
        try {
            switch (category) {
                case 'general':
                    return this.Config.general[prop];
                case 'static':
                    return this.Config.static[prop];
                case 'security':
                    return this.Config.security[prop];
                default:
                    throw 'Unsuported category';
            }
        }
        catch (e) {
            throw "Property " + prop + " of category " + category + " not found in service setup configuration.";
        }
    }
    // Build up the configuration object
    MicroService.prototype.Init = function (config) {

        // General
        for (var i = 0; i < config.generalConfig.length; i++) {
            var name = config.generalConfig[i].id;
            var val = config.generalConfig[i].value;
            if (typeof val == "string" && val.startsWith("env:")) {
                this.Config.general[name] = process.env[val.substring(4)];
            }
            else {
                this.Config.general[name] = val;
            }
        };

        // Static
        for (var i = 0; i < config.staticConfig.length; i++) {
            var name = config.staticConfig[i].id;
            var val = config.staticConfig[i].value;
            if (typeof val == "string" && val.startsWith("env:")) {
                this.Config.static[name] = process.env[val.substring(4)];
            }
            else {
                this.Config.static[name] = val;
            }
        };

        // Security
        for (var i = 0; i < config.securityConfig.length; i++) {
            var name = config.securityConfig[i].id;
            var val = config.securityConfig[i].value;
            if (typeof val == "string" && val.startsWith("env:")) {
                this.Config.security[name] = process.env[val.substring(4)];
            }
            else {
                this.Config.security[name] = val;
            }
        };

    }

    extend(this, microService);
}

module.exports = MicroService;