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
    var npmPackage = "azure-iot-device-mqtt@1.2.1";

    switch (connectionSettings.communicationProtocol) {
        case "MQTT":
        case "MQTT-WS":
        npmPackage = "azure-iot-device@1.2.1,azure-iot-device-mqtt@1.2.2,azure-iot-common@1.2.2";
            break;
        case "AMQP":
        case "AMQP-WS":
            npmPackage = "azure-iot-device@1.2.1,azure-iot-device-amqp@1.2.1,azure-iot-common@1.2.2";
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
        if (isConnected) {
            callback();
            return;
        }
        me = this;
        stop = false;

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

                    receiver.open(function (err, transport) {
                        if (err) {
                            me.onQueueErrorReceiveCallback('AZURE IoT: Could not connect: ' + err);
                            if (err.name === "UnauthorizedError") {
                                me.onUnauthorizedErrorCallback();
                                callback();
                                return;
                            }
                        }
                        else {
                            me.onQueueDebugCallback("AZURE IoT: Receiver is ready");
                            isConnected = true;
                            receiver.on('disconnect', function () {
                                isConnected = false;
                                me.onQueueErrorReceiveCallback('AZURE IoT: Disconnected');
                            });

                            receiver.on('error', function (err) {
                                console.error(err.message);
                                me.onQueueErrorReceiveCallback('AZURE IoT: Error: ' + err.message);
                            });

                            receiver.on('message', function (msg) {
                                try {
                                    var service = msg.properties.propertyList.find(function (i) {
                                        return i.key === "service";
                                    });
                                    var message = JSON.parse(msg.data.toString('utf8'));
                                    var responseData = {
                                        body: message,
                                        applicationProperties: { value: { service: service.value } }
                                    }
                                    me.onQueueMessageReceivedCallback(responseData);
                                    receiver.complete(msg, function () { });
                                }
                                catch (e) {
                                    me.onQueueErrorReceiveCallback('AZURE IoT: Could not connect: ' + e.message);
                                }
                            });


                            receiver.getTwin(function (err, twin) {
                                if (err) {
                                    me.onQueueErrorReceiveCallback('AZURE IoT: Could not get twin: ' + err);
                                }
                                else {
                                    me.twin = twin;
                                    me.onQueueDebugCallback("AZURE IoT: Device twin is ready");
                                    twin.on('properties.desired', function (desiredChange) {
                                        // Incoming state
                                        me.onQueueDebugCallback("AZURE IoT: Received new state");
                                        me.currentState = {
                                            desired: desiredChange,
                                            reported: twin.properties.reported
                                        }
                                        me.onStateReceivedCallback(me.currentState);
                                    });
                                }
                            });


                            // Only start sender if key is provided
                            if (connectionSettings.senderToken && !sender) {
                                startSender(function () {
                                    callback();
                                    return;
                                });
                            }
                            else {
                                if (callback != null)
                                    callback();
                                return;
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
                callback();
                return;
            }
        });
    };
    AZUREIOT.prototype.ChangeState = function (state, node) {
        me.onQueueDebugCallback("AZURE IoT: device state is changed");
        if (!this.twin) {
            me.onQueueErrorSubmitCallback('AZURE IoT: Device twin not registered');
            return;
        }
        me.twin.properties.reported.update(state.reported, function (err) {
            if (err) {
                me.onQueueErrorReceiveCallback('AZURE IoT: Could not update twin: ' + err.message);
            } else {
                me.onQueueDebugCallback("AZURE IoT: twin state reported");
            }
        });

    };
    AZUREIOT.prototype.Stop = function (callback) {
        stop = true;
        //clearTimeout(tokenRefreshTimer);
        if (sender) {
            sender.close(function () {
                receiver.close(function () {
                    me.onQueueDebugCallback("AZURE IoT: Stopped");
                    callback();
                });
            });
        }
        else
            callback();
    };
    AZUREIOT.prototype.Submit = function (msg, node, service) {
        var me = this;
        if (stop || !isConnected) {
            let persistMsg = {
                node: node,
                service: service,
                message: message
            };
            if (storageIsEnabled)
                me.persistMessage(persistMsg);

            return;
        }

        var json = JSON.stringify(msg);
        var message = new Message(json);

        message.properties.add("service", service);
        sender.send(node, message, function (err) {
            if (err)
                me.onQueueErrorReceiveCallback(err);
        });
    };
    AZUREIOT.prototype.Track = function (trackingMessage) {
        try {
            var me = this;
            if (stop || !isConnected) {
                if (storageIsEnabled)
                    me.persistTracking(trackingMessage);

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
                            me.persistTracking(trackingMessage);
                    }
                    else if (res.statusCode >= 200 && res.statusCode < 300) {
                    }
                    else if (res.statusCode == 401) {
                        console.log("Invalid token. Updating token...")

                        //acquireToken("MICROSERVICEBUS", "TRACKING", restTrackingToken, function (token) {
                        //    if (token == null && storageIsEnabled) {
                        //        me.onQueueErrorSubmitCallback("Unable to aquire tracking token: " + token);
                        //        storage.setItem("_tracking_" + trackingMessage.InterchangeId, trackingMessage);
                        //        return;
                        //    }

                        //    restTrackingToken = token;
                        //    me.Track(trackingMessage);
                        //});
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
    AZUREIOT.prototype.SubmitEvent = function (msg, service) {
        var me = this;
        if (stop || !isConnected) {
            if (!isConnected) {
                me.onQueueErrorReceiveCallback("Connection to the Azure IoT Hub cannot be established, persisting messages");
            }
            if (stop) {
                me.onQueueErrorReceiveCallback("Service is stopped, persisting messages");
            }
            let persistMsg = {
                node: this.settingsHelper.settings.nodeName,
                service: service,
                message: JSON.stringify(msg)
            };
            if (storageIsEnabled)
                me.persistEvent(persistMsg);

            return;
        }

        var json = JSON.stringify(msg);
        var message = new Message(json);

        receiver.sendEvent(message, function (err) {
            if (err) {
                me.onQueueErrorReceiveCallback('Unable to send message to to Azure IoT Hub');
            }
            else {
                me.onQueueDebugCallback("Event has been sent to Azure IoT Hub");
            }
        });
    };
    AZUREIOT.prototype.IsConnected = function () {
        return isConnected;
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
            }
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

