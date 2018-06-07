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
const path = require('path');
const fs = require('fs');
var httpRequest = require('request');
var util = require('../utils.js');
var extend = require('extend');

function AWSIOT(nodeName, connectionSettings) {
    var me = this;
    var stop = false;
    var isSubscribing = false;
    var storageIsEnabled = true;
    var awsIot;
    var thingShadow;
    var isConnected = false;
    // Setup tracking
    var baseAddress = "https://" + connectionSettings.sbNamespace;
    if (!baseAddress.match(/\/$/)) {
        baseAddress += '/';
    }
    var restTrackingToken = connectionSettings.trackingToken;

    AWSIOT.prototype.Start = function (callback) {
        if (isConnected) {
            callback();
            return;
        }
        me = this;
        stop = false;
        me.onQueueDebugCallback("AWS device is starting");
        util.addNpmPackages("aws-iot-device-sdk@1.0.14", false, function (err) {
            if (err) {
                me.onQueueErrorReceiveCallback("Unable to download AWS IoT npm package");
                if (callback)
                    callback();
            }
            else {
                awsIot = require("aws-iot-device-sdk");
                var certDir = me.settingsHelper.certDirectory;//'./cert/';
                var certSettingsFile = path.resolve(certDir, nodeName + '.settings');
                var data = fs.readFileSync(certSettingsFile, 'utf8');
                var settings = JSON.parse(data);

                if (!thingShadow) {
                    let options = {
                        keyPath: path.resolve(certDir, nodeName + '.private.key'),
                        certPath: path.resolve(certDir, nodeName + '.cert.pem'),
                        caPath: path.resolve(certDir, 'root-ca.crt'),
                        clientId: nodeName,
                        region: settings.region
                    };
                    thingShadow = awsIot.thingShadow(options);

                    thingShadow.register(nodeName, {
                        persistentSubscribe: true,
                        ignoreDeltas: false
                    });

                    thingShadow.on('connect', function () {
                        me.onQueueDebugCallback("AWS Connected to AWS IoT Hub");
                        isConnected = true;

                        if (!isSubscribing) {
                            setTimeout(function () {
                                thingShadow.subscribe(nodeName, function (error, result) {
                                    me.onQueueDebugCallback("AWS Subscribing to " + nodeName);
                                    isSubscribing = true;
                                });
                                var opClientToken = thingShadow.get(nodeName);
                                if (opClientToken === null) {
                                    console.log('operation in progress');
                                }
                            }, 3000);
                        }

                        if (callback != null)
                            callback();
                    });
                    thingShadow.on('close', function () {
                        isConnected = false;
                        //me.onQueueDebugCallback("AWS device is closed");
                        //thingShadow.unregister(nodeName);
                        //thingShadow.unsubscribe(nodeName, function (error, result) {
                        //    me.onQueueDebugCallback("AWS device is stopped");
                        //    callback();
                        //});
                    });
                    thingShadow.on('reconnect', function () {
                        me.onQueueDebugCallback("AWS device is reconnecting");
                    });
                    thingShadow.on('error', function (error) {
                        isConnected = false;
                        me.onQueueErrorReceiveCallback("AWS error: " + error);
                    });
                    thingShadow.on('message', function (topic, payload) {
                        try {
                            var json = payload.toString();
                            var message = JSON.parse(json);

                            var responseData = {
                                body: message,
                                applicationProperties: { value: { service: message.service } }
                            }
                            me.onQueueMessageReceivedCallback(responseData);

                        }
                        catch (e) {
                            me.onQueueErrorReceiveCallback('Error receiving the message: ' + e.message);
                        }
                    });
                    thingShadow.on('status', function (thingName, status, clientToken, stateObject) {
                        try {
                            me.onQueueDebugCallback("AWS - Received Desired State");
                            if (status === 'accepted' && stateObject.state.desired) {
                                me.currentState = stateObject.state;
                                me.onStateReceivedCallback(stateObject.state);
                            }
                            else {
                                me.onQueueDebugCallback("AWS - State not accepted");
                            }
                        }
                        catch (e) {
                            me.onQueueErrorReceiveCallback('Error receiving Desired State: ' + e.message);
                        }
                    });
                    thingShadow.on('delta', function (thingName, stateObject) {
                        me.onQueueDebugCallback("AWS - Received delta");
                        if (stateObject.state.msbaction) {

                            // Merge old state with new
                            var actionToMerge = JSON.parse(JSON.stringify(me.currentState.desired.msbaction));
                            extend(actionToMerge, stateObject.state.msbaction);
                            me.currentState.desired.msbaction = actionToMerge;

                            me.onStateReceivedCallback(me.currentState);

                            me.onQueueDebugCallback("AWS - Received MSB ACTION");
                        }
                        //else {
                        //    var state = JSON.stringify(stateObject);
                        //    me.onStateReceivedCallback(state);
                        //}
                        //thingShadow.update(thingName, {
                        //    state: {
                        //        reported: stateObject.state
                        //    }
                        //});
                    });
                    thingShadow.on('timeout', function (nodeName, clientToken) {
                        console.warn('timeout: ' + nodeName + ', clientToken=' + clientToken);
                    });
                }
                else {
                    if (stop) {
                        thingShadow.subscribe(nodeName, function (error, result) {
                            me.onQueueDebugCallback("AWS device is subscribing to " + nodeName);
                            if (callback)
                                callback();
                        });
                    }
                    else {
                        callback();
                    }
                }


            }
        });
    };
    AWSIOT.prototype.ChangeState = function (state, node) {
        me.settingsHelper.settings.deviceState.reported = state;
        me.settingsHelper.save();
        me.onQueueDebugCallback("AWS device state is changed");
        thingShadow.update(node, {
            state: state
        });
    };
    AWSIOT.prototype.Stop = function (callback) {
        this.onQueueDebugCallback("AWS Stop called ");

        stop = true;
        if (thingShadow) {
            thingShadow.unsubscribe(nodeName, function (error, result) {
                me.onQueueDebugCallback("AWS device is stopped");
                isSubscribing = false;
                callback();
            });
        }
        else
            callback();
    };
    AWSIOT.prototype.Submit = function (message, node, service) {
        if (stop || !isConnected) {
            let persistMsg = {
                node: node,
                service: service,
                message: message
            };
            if (storageIsEnabled)
                me.onPersistMessageCallback(persistMsg);

            return;
        }
        message.service = service;

        thingShadow.publish(node, JSON.stringify(message));

    };
    AWSIOT.prototype.Track = function (trackingMessage) {
        try {
            var me = this;
            if (stop || !isConnected) {
                if (storageIsEnabled)
                    me.onPersistTrackingCallback(trackingMessage);

                return;
            }

            var trackUri = baseAddress + connectionSettings.trackingHubName + "/messages" + "?timeout=60";

            httpRequest({
                headers: {
                    "Authorization": restTrackingToken,
                    "Content-Type": "application/json",
                },
                uri: trackUri,
                json: trackingMessage,
                method: 'POST'
            },
                function (err, res, body) {
                    if (err != null) {
                        me.onQueueErrorSubmitCallback("Unable to send message. " + err.code + " - " + err.message)
                        console.log("Unable to send message. " + err.code + " - " + err.message);
                        if (storageIsEnabled)
                            me.onPersistTrackingCallback(trackingMessage);
                    }
                    else if (res.statusCode >= 200 && res.statusCode < 300) {
                    }
                    else if (res.statusCode == 401) {
                        console.log("Invalid token. Updating token...");

                        return;
                    }
                    else {
                        console.log("Unable to send message. " + res.statusCode + " - " + res.statusMessage);

                    }
                });

        }
        catch (err) {
            console.log();
        }
    };
    AWSIOT.prototype.Update = function (settings) {
        restTrackingToken = settings.trackingToken;
    };
    AWSIOT.prototype.IsConnected = function () {
        return isConnected;
    };

}
module.exports = AWSIOT;

