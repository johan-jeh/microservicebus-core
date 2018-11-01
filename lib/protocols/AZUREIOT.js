﻿/*
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

var Message;
var url = require("url");
var crypto = require('crypto');
var httpRequest = require('request');
var storage = require('node-persist');
var util = require('../utils.js');
var guid = require('uuid');

function AZUREIOT(nodeName, connectionSettings) {
    var me = this;
    var stop = false;
    var storageIsEnabled = true;
    var sender;
    var receiver;
    var twin;
    var tracker;
    var tokenRefreshTimer;
    var tokenRefreshInterval = (connectionSettings.tokenLifeTime * 60 * 1000) * 0.9;
    var isConnected = false;
    this.startInProcess = false;
    var npmPackage = "azure-iot-device-mqtt@1.3.2";

    switch (connectionSettings.communicationProtocol) {
        case "MQTT":
        case "MQTT-WS":
            npmPackage = "azure-iot-common@1.5.0,azure-iot-device@1.4.0,azure-iot-device-mqtt@1.4.0";
            break;
        case "AMQP":
        case "AMQP-WS":
            npmPackage = "azure-iot-common@1.5.0,azure-iot-device@1.4.0,azure-iot-device-amqp@1.4.0";
            break;
        default:
            break;
    }

    // Setup tracking
    var baseAddress = "https://" + connectionSettings.sbNamespace;
    if (!baseAddress.match(/\/$/)) {
        baseAddress += '/';
    }
    var restTrackingToken = connectionSettings.trackingToken;

    AZUREIOT.prototype.Start = function (callback) {
        if (me.IsConnected() || me.startInProcess) {
            me.onQueueDebugCallback("AZURE IoT: Already connected, ignoring start");
            callback();
            return;
        }
        me = this;
        stop = false;
        me.startInProcess = true;
        util.addNpmPackages(npmPackage, false, function (err) {
            try {
                if (err)
                    me.onQueueErrorReceiveCallback("AZURE IoT: Unable to download Azure IoT npm packages");
                else {
                    Message = require('azure-iot-common').Message;
                    var ReceiveClient = require('azure-iot-device').Client;
                    var DeviceProtocol;
                    me.onQueueDebugCallback("AZURE IoT: Using " + connectionSettings.communicationProtocol);

                    switch (connectionSettings.communicationProtocol) {
                        case "MQTT":
                            DeviceProtocol = require('azure-iot-device-mqtt').Mqtt;
                            break;
                        case "MQTT-WS":
                            DeviceProtocol = require('azure-iot-device-mqtt').MqttWs;
                            break;
                        case "AMQP":
                            DeviceProtocol = require('azure-iot-device-amqp').Amqp;
                            break;
                        case "AMQP-WS":
                            DeviceProtocol = require('azure-iot-device-amqp').AmqpWs;
                            break;
                        default:
                            DeviceProtocol = require('azure-iot-device-mqtt').Mqtt;
                            break;
                    }

                    if (!receiver) {
                        if (connectionSettings.receiveConnectionString) {
                            me.onQueueDebugCallback("AZURE IoT: Using Connection String");
                            receiver = ReceiveClient.fromConnectionString(connectionSettings.receiveConnectionString, DeviceProtocol);
                        }
                        else {
                            me.onQueueDebugCallback("AZURE IoT: Using Shared Access Signature");
                            receiver = ReceiveClient.fromSharedAccessSignature(connectionSettings.receiverToken, DeviceProtocol);
                        }
                    }

                    // Disable retry policy
                    let NoRetry = require('azure-iot-common').NoRetry;
                    receiver.setRetryPolicy(new NoRetry());

                    receiver.open(function (err, transport) {
                        if (err) {
                            me.onQueueErrorReceiveCallback('AZURE IoT: Could not connect: ' + err);
                            if (err.name === "UnauthorizedError") {
                                me.onUnauthorizedErrorCallback();
                            }
                            
                            callback(err);
                            me.startInProcess = false;
                            return;

                        }
                        else {
                            me.onQueueDebugCallback("AZURE IoT: Receiver is ready");
                            isConnected = true;
                            receiver.on('disconnect', function () {
                                isConnected = false;
                                receiver = null;
                                me.twin = null;
                                me.onDisconnectCallback('AZURE IoT: Disconnected', !stop);
                            });

                            receiver.on('error', function (err) {
                                console.error(err.message);
                                me.onQueueErrorReceiveCallback('AZURE IoT: Error: ' + err.message);
                                me.onQueueErrorReceiveCallback('AZURE IoT: Error: ' + JSON.stringify(err));
                                let twinError = me.twin ? JSON.stringify(me.twin) : null;
                                me.onQueueErrorReceiveCallback('AZURE IoT: Twin state: ' + twinError);
                            });

                            receiver.on('message', function (msg) {
                                try {
                                    var service = msg.properties.propertyList.find(function (i) {
                                        return i.key === "service";
                                    });

                                    // Parse to object
                                    let message = JSON.parse(msg.data.toString('utf8'));

                                    if (!service) { // D2C message has no destination 
                                        me.onQueueDebugCallback("AZURE IoT: Message recieved from Azure");
                                        me.onMessageReceivedCallback(message);
                                        receiver.complete(msg, function () { });
                                    }
                                    else { // D2D message with destination (service) defined
                                        var responseData = {
                                            body: message,
                                            applicationProperties: { value: { service: service.value } }
                                        }
                                        me.onQueueMessageReceivedCallback(responseData);
                                        receiver.complete(msg, function () { });
                                    }
                                }
                                catch (e) {
                                    me.onQueueErrorReceiveCallback('AZURE IoT: Could not connect: ' + e.message);
                                }
                            });

                            try {
                                receiver.getTwin(function (err, twin) {
                                    me.twin = twin;

                                    if (err) {
                                        me.onQueueErrorReceiveCallback('AZURE IoT: Could not get twin: ' + err);
                                        me.startInProcess = false;
                                        callback(err);
                                    }
                                    else {
                                        me.onQueueDebugCallback("AZURE IoT: Device twin is ready");

                                        twin.on('properties.desired', function (desiredChange) {
                                            // Incoming state
                                            me.onQueueDebugCallback("AZURE IoT: Received new state");
                                            me.currentState = {
                                                desired: desiredChange,
                                                reported: twin.properties.reported
                                            };
                                            me.onStateReceivedCallback(me.currentState);
                                            if (me.startInProcess) {
                                                me.startInProcess = false;
                                                callback();
                                            }
                                        });
                                    }
                                });
                            }
                            catch (twinError) {
                                me.onQueueDebugCallback("AZURE IoT: An error occured when starting the TWIN:");
                                me.onQueueDebugCallback("AZURE IoT: " + twinError);
                                me.onQueueDebugCallback("AZURE IoT: PLEASE CONSIDER restarting the node");
                                me.startInProcess = false;
                                callback(twinError);
                            }
                            // Only start sender if key is provided
                            if (connectionSettings.senderToken && !sender) {
                                startSender(function () {
                                    return;
                                });
                            }
                        }
                    });

                    if (!tokenRefreshTimer) {
                        tokenRefreshTimer = setInterval(function () {
                            me.onQueueDebugCallback("Update tracking tokens");
                            acquireToken("AZUREIOT", "TRACKING", restTrackingToken, function (token) {
                                if (token == null) {
                                    me.onQueueErrorSubmitCallback("Unable to aquire tracking token: " + token);
                                }
                                else {
                                    restTrackingToken = token;
                                }
                            });
                        }, tokenRefreshInterval);
                    }
                }
            }
            catch (ex) {
                me.onQueueErrorReceiveCallback("AZURE IoT: " + ex);
                me.startInProcess = false;
                callback(ex);
            }
        });
    };
    AZUREIOT.prototype.ChangeState = function (state, node) {
        me.settingsHelper.settings.deviceState.reported = state;
        me.settingsHelper.save();
        me.onQueueDebugCallback("AZURE IoT: device state is changed");
        if (!this.twin) {
            me.onQueueErrorSubmitCallback('AZURE IoT: Device twin not registered');
            return;
        }
        me.twin.properties.reported.update(state, function (err) {
            if (err) {
                me.onQueueErrorReceiveCallback('AZURE IoT: Could not update twin: ' + err.message);
            } else {
                me.onQueueDebugCallback("AZURE IoT: twin state reported");
            }
        });

    };
    AZUREIOT.prototype.Stop = function (callback) {
        stop = true;
        if (sender) {
            try {
                sender.close();
            }
            catch (err) {
                console.log('');

            }
        }
        if (receiver) {
            me.onQueueDebugCallback("AZURE IoT: Closing receiver");
            receiver.close(function () {
                me.onQueueDebugCallback("AZURE IoT: Stopped");
                isConnected = false;
                me.twin = null;
                receiver = undefined;
                callback();
            });
        }
        else {
            isConnected = false;
            me.twin = null;
            receiver = undefined;
            callback();
        }
    };
    AZUREIOT.prototype.Submit = function (msg, node, service) {
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

        var json = JSON.stringify(msg);
        var message = new Message(json);

        message.properties.add("service", service);
        sender.send(node, message, function (err) {
            if (err)
                me.onSubmitQueueErrorCallback(err);
        });
    };
    AZUREIOT.prototype.Track = function (trackingMessage) {
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
                        console.log("Invalid token. Updating token...")

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
    AZUREIOT.prototype.Update = function (settings) {
        restTrackingToken = settings.trackingToken;
        me.onQueueDebugCallback("Tracking token updated");
    };
    AZUREIOT.prototype.SubmitEvent = function (msg, service, properties) {
        if (stop || !isConnected) {
            if (!isConnected) {
                me.onDisconnectCallback("Connection to the Azure IoT Hub cannot be established, persisting messages", !stop);
            }
            if (stop) {
                me.onQueueErrorReceiveCallback("Service is stopped, persisting messages");
            }

            let persistMsg = {
                node: me.settingsHelper.settings.nodeName,
                service: service,
                message: JSON.stringify(msg)
            };
            if (storageIsEnabled) {
                var isResend = false;
                if (properties) {
                    isResend = properties.find(function (p) {
                        return p.Variable === "resent";
                    });
                }
                if (!isResend)
                    me.onPersistEventCallback(persistMsg);
            }
            return;
        }

        var json = JSON.stringify(msg);
        var message = new Message(json);

        if (properties) {
            for (let i = 0; i < properties.length; i++) {
                message.properties.add(properties[i].Variable, properties[i].Value);
            }
        }
        receiver.sendEvent(message, function (err) {
            if (err) {
                me.onSubmitQueueErrorCallback('Unable to send message to to Azure IoT Hub');
            }
            else {
                me.onPersistHistoryCallback(msg);
                me.onSubmitQueueSuccessCallback("Event has been sent to Azure IoT Hub");
            }
        });
    };
    AZUREIOT.prototype.IsConnected = function () {
        return me.twin != undefined;
    };
    AZUREIOT.prototype.RegisterDirectMethod = function(methodName, callback) {
        receiver.onDeviceMethod(methodName, callback);
    };

    function startSender(callback) {
        util.addNpmPackages("azure-iothub", false, function (err) {
            var SendClient = require('azure-iothub').Client;
            var ServiceProtocol = require('azure-iothub').AmqpWs; // Default transport for Receiver
            sender = SendClient.fromSharedAccessSignature(connectionSettings.senderToken, ServiceProtocol);
            sender.open(function (err) {
                if (err) {
                    me.onQueueErrorReceiveCallback('AZURE IoT: Unable to connect to Azure IoT Hub (send) : ' + err);
                }
                else {
                    me.onQueueDebugCallback("AZURE IoT: Sender is ready");
                }
                callback();
            });
        });
    }
    function acquireToken(provider, keyType, oldKey, callback) {
        try {
            var acquireTokenUri = me.hubUri.replace("wss:", "https:") + "/api/Token";
            var request = {
                "provider": provider,
                "keyType": keyType,
                "oldKey": oldKey
            };
            httpRequest({
                headers: {
                    "Content-Type": "application/json",
                },
                uri: acquireTokenUri,
                json: request,
                method: 'POST'
            },
                function (err, res, body) {
                    if (err != null) {
                        me.onQueueErrorSubmitCallback("Unable to acquire new token. " + err.message);
                        callback(null);
                    }
                    else if (res.statusCode >= 200 && res.statusCode < 300) {
                        callback(body.token);
                    }
                    else {
                        me.onQueueErrorSubmitCallback("Unable to acquire new token. Status code: " + res.statusCode);
                        callback(null);
                    }
                });
        }
        catch (err) {
            process.exit(1);
        }
    };
}
module.exports = AZUREIOT;

