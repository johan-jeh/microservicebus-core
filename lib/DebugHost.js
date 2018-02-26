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
var util = require('./utils.js');
var signalR = require('./v8debug/signalR.js');
var fs = require('fs');
var path = require('path');
var DebugClient = require('./v8debug/');
var ProgressBar = require('progress');
var rootFolder = process.arch == 'mipsel' ? '/mnt/sda1' : __dirname;
var maxWidth = 75;

function DebugHost(settingsHelper) {

    var self = this;
    // Events
    this.onReady;
    this.onStopped;
    var bm;
    var sm;
    var isStarted = false;
    var debugClient;
    var ScriptManager = DebugClient.ScriptManager;
    var debugPort;
    var interval;
    var isIdle = true;
    const SERVICEFOLDER = path.join(path.join(rootFolder.replace("lib", ""), "lib"), "services");
    var breakpoints;

    DebugHost.prototype.OnReady = function (callback) {
        this.onReady = callback;
    };
    DebugHost.prototype.OnStopped = function (callback) {
        this.onStopped = callback;
    };

    DebugHost.prototype.Start = function (port) {
        debugPort = port;
        setUpClient(function () {
            signalRClient.start();

        });
    };
    DebugHost.prototype.Stop = function (callback) {
        clearInterval(interval);
        signalRClient.end();
        debugClient.disconnect();
        callback();
    };

    var signalRClient = new signalR.client(
        settingsHelper.settings.hubUri + '/signalR',
        ['debuggerHub'],
        10, //optional: retry timeout in seconds (default: 10)
        true
    );

    // Private methods
    function log(msg) {
        msg = " " + msg;
        console.log(util.padRight(msg, maxWidth, ' ').bgYellow.white.bold);

    }
    function debugLog(msg) {
        msg = " " + msg;
        console.log(util.padRight(msg, maxWidth, ' ').bgGreen.white.bold);
    }
    function setUpClient(callback) {
        try {
            signalRClient.serviceHandlers = {
                bound: function () { log("Connection: " + "bound"); },
                connectFailed: function (error) {
                    log("Connection: " + "Connect Failed");
                },
                connected: function (connection) {
                    log("Connection: " + "Connected!");
                    signalRClient.invoke('debuggerHub', 'debug_signIn', settingsHelper.settings.nodeName, settingsHelper.settings.organizationId);
                    checkIdle(12, function () {
                        signalRClient.invoke('debuggerHub', 'debug_signIn', settingsHelper.settings.nodeName, settingsHelper.settings.organizationId);
                    });
                },
                disconnected: function () {

                    log("Connection: " + "Disconnected");
                    debugClient.out(function (err, doneOrNot) { });
                },
                onerror: function (error) {
                    log("Connection: " + "Error: ", error);
                    debugClient.out(function (err, doneOrNot) { });
                },
                messageReceived: function (message) {

                },
                bindingError: function (error) {
                    log("Connection: " + "Binding Error: " + error);
                    debugClient.out(function (err, doneOrNot) { });
                },
                connectionLost: function (error) {
                    //_isWaitingForSignInResponse = false;
                    log("Connection: " + "Connection Lost");
                    debugClient.out(function (err, doneOrNot) { });
                },
                reconnected: void function (connection) {
                    log("Connection: " + "Reconnected ");
                },
                onUnauthorized: function (res) { },
                reconnecting: function (retry /* { inital: true/false, count: 0} */) {
                    log("Connection: " + "Retrying to connect ");
                    return true;
                }
            };

            signalRClient.on('debuggerHub', 'debug_signedInComplete', function (message) {
                isIdle = false;
                log("debug_signedInComplete");
                checkIdle(5, function () {
                    signalRClient.invoke('debuggerHub', 'debug_signIn', settingsHelper.settings.nodeName, settingsHelper.settings.organizationId);
                });
            });
            signalRClient.on('debuggerHub', 'debug_start', function (brkpoints) {
                isIdle = false;

                log("debug_start");
                try {
                    breakpoints = brkpoints;
                    initDebugClient();
                }
                catch (ex) {
                    log("exception:" + ex);
                }
            });
            signalRClient.on('debuggerHub', 'debug_continue', function (message) {
                isIdle = false;
                debugClient.continue(function (err, doneOrNot) { });
                checkIdle(12, function () { });
            });
            signalRClient.on('debuggerHub', 'debug_next', function (message) {
                isIdle = false;
                debugClient.next(function (err, doneOrNot) { });
                checkIdle(12, function () { });
            });
            signalRClient.on('debuggerHub', 'debug_stepIn', function (message) {
                isIdle = false;
                debugClient.in(function (err, doneOrNot) { });
                checkIdle(12, function () { });
            });
            signalRClient.on('debuggerHub', 'debug_stepOver', function (message) {
                isIdle = false;
                debugClient.out(function (err, doneOrNot) { });
                checkIdle(12, function () { });
            });
            signalRClient.on('debuggerHub', 'debug_stop', function (message) {
                isStarted = false;
                checkIdle(2, function () { });
            });
            callback();
        }
        catch (err) {
            callback();
            checkIdle(3, function () { });
        }
    }
    function initDebugClient(port) {

        debugClient = new DebugClient(debugPort);

        debugClient.on('connect', function () {
            debugLog("Debugger Connected");
            try {
                bm = new DebugClient.BreakPointManager(debugClient);
                sm = new ScriptManager(debugClient);

                breakpoints.forEach(function (myBrakpoint) {
                    console.log("serviceDirectory: " + settingsHelper.serviceDirectory.bgRed.green);
                    var scriptFile = path.join(settingsHelper.serviceDirectory, myBrakpoint.script);
                    //var scriptFile = path.join(SERVICEFOLDER, myBrakpoint.script);
                    bm.createBreakpoint(scriptFile, myBrakpoint.line, myBrakpoint.condition)
                        .then(function (breakpoint) {
                            debugLog("breakpoint set at line " + myBrakpoint.line + " in " + myBrakpoint.script);
                        });
                });
                debugLog("debug_breakpointsSet");
                signalRClient.invoke('debuggerHub', 'debug_breakpointsSet');
                checkIdle(12, function () {
                    signalRClient.invoke('debuggerHub', 'debug_breakpointsSet');
                });

            }
            catch (ex) {
                log("exception:" + ex);
            }
        });

        debugClient.on('break', function (breakInfo) {
            debugLog("break in " + path.basename(breakInfo.script.name) + " at " + breakInfo.sourceLine);
            var info = {
                script: path.basename(breakInfo.script.name),
                line: breakInfo.sourceLine,
                column: breakInfo.sourceColumn
            };
            signalRClient.invoke('debuggerHub', 'debug_breakpointsHit', info);

            debugClient.getFrame(function (err, frame) {
                debugLog("Got Frame data");
                var variables = [];
                for (var i = 0; i < frame.body.locals.length; i++) {
                    var variable = frame.body.locals[i];
                    var name = variable.name;
                    var value = frame.refs.find(function (ref) {
                        return ref.handle === variable.value.ref;
                    })
                    if (value.type !== "undefined")
                        variables.push({
                            name: name,
                            value: value.text,
                            type: value.type
                        });
                }
                info.variables = variables;
                signalRClient.invoke('debuggerHub', 'debug_breakpointFrame', info);
            })
        })
    }
    function checkIdle(retries, retryCommand) {
        var retryCount = 0;
        var RESTARTLEVEL = retries;
        var RETRYLEVEL = retries - 2;
        if (interval)
            clearInterval(interval);
        isIdle = true;

        var bar = new ProgressBar('  Waiting [:bar]'.grey, {
            complete: '¤',
            incomplete: ' ',
            width: 20,
            total: RESTARTLEVEL
        });

        interval = setInterval(function () {
            if (!isIdle)
                clearInterval(interval);
            else {
                //debugLog("Register idle activity")
                retryCount++;
                bar.tick();
                if (bar.complete) {
                    debugLog("Shutting down debug process...")
                    clearInterval(interval);
                    // Kill process
                    self.onStopped();
                }
                if (retryCount > RETRYLEVEL) {
                    //debugLog("Trying to notify server again...")
                    retryCommand();
                }
            }
        }, 3000);
    }
}
module.exports = DebugHost;