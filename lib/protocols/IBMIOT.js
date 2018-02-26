/*
The MIT License (MIT)

Copyright (c) 2014 microServiceBus.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without IBMIOTriction, including without limitation the rights
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
var crypto = require('crypto');
var httpRequest = require('request');
var storage = require('node-persist');
var util = require('../utils.js');
var guid = require('uuid');

function IBMIOT(nodeName, sbSettings) {

    var storageIsEnabled = true;
    var stop = false;
    var me = this;
    var tokenRefreshTimer;
    var tokenRefreshInterval = (sbSettings.tokenLifeTime * 60 * 1000) * 0.9;
    var IBMIOTTrackingToken = sbSettings.trackingToken;
    var baseAddress = "https://" + sbSettings.sbNamespace;
    var client;
    var isConnected = false;

    if (!baseAddress.match(/\/$/)) {
        baseAddress += '/';
    }

    IBMIOT.prototype.Start = function (callback) {
        me = this;
        stop = false;
        me.onQueueDebugCallback("IBM Bluemix device is starting");
        util.addNpmPackages("ibmiotf", false, function (err) {
            if (err) {
                me.onQueueErrorRecieveCallback("Unable to download IBM Bluemix IoT npm package");
                if (callback)
                    callback();
            }
            else {
                var Client = require("ibmiotf");
                client = new Client.IotfGateway(sbSettings.connectionSettings);
                client.connect();
                me.onQueueDebugCallback('Connected to IBM Bluemix IoT Hub');
                client.on('connect', function () {
                    client.subscribeToGatewayCommand('msbEvent');
                    me.onQueueDebugCallback('IBM Bluemix device is subscribing to ');
                    if (callback)
                        callback();
                });
                client.on('command', function (type, id, commandName, commandFormat, responseData, topic) {
                    me.onQueueMessageReceivedCallback(responseData);
                    me.onQueueDebugCallback("Command received");
                    console.log("Type: %s  ID: %s  \nCommand Name : %s Format: %s", type, id, commandName, commandFormat);
                    console.log("Payload : %s", responseData.body);
                    client.on('reconnect', function () {
                        me.onQueueDebugCallback('Reconnected to IBM Bluemix Iot Hub');
                    });
                });
            }
        });
    };
    IBMIOT.prototype.Stop = function (message, node, service) {
        client.onQueueDebugCallback('IBM Bluemix Stop called');
        stop = true;
        if (client.isConnected()) {
            client.on('disconnect', function () {
                me.onQueueDebugCallback('Disconnected to IBM Bluemix IoT Hub');
                callback();
            });
        }
        else {
            callback();
        }
    };
    IBMIOT.prototype.Submit = function (message, node, service) {
        me.onQueueErrorRecieveCallback("Unable to send command or event from a device to a device");
    };
    IBMIOT.prototype.SendEvent = function (eventType, message, callback) {
        var me = this;
        if (stop || !client.isConnected()) {
            if (!client.isConnected()) {
                me.onQueueErrorReceiveCallback("Connection to the IBM IoT Hub cannot be established, persisting messages");
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
                me.onPersistEventCallback(persistMsg);

            return;
        }

        var json = JSON.stringify(msg);
        var message = new Message(json);

        client.publishGatewayEvent(eventType, 'json', message, 1, function (err) {
            if (err) {
                me.onQueueErrorReceiveCallback('Unable to send message to to Azure IoT Hub');
            }
            else {
                me.onQueueDebugCallback("Event has been sent to Azure IoT Hub");
            }
        });
    };
    IBMIOT.prototype.Track = function (trackingMessage) {
        try {
            var me = this;
            if (stop || !isConnected) {
                if (storageIsEnabled)
                    me.onPersistTrackingCallback(trackingMessage);

                return;
            }

            var trackUri = baseAddress + sbSettings.trackingHubName + "/messages" + "?timeout=60";

            httpRequest({
                headers: {
                    "Authorization": IBMIOTTrackingToken,
                    "Content-Type": "application/json",
                },
                uri: trackUri,
                json: trackingMessage,
                method: 'POST'
            },
                function (err, res, body) {
                    if (err != null) {
                        me.onQueueErrorSubmitCallback("Unable to send message. " + err.code + " - " + err.message);
                        console.log("Unable to send message. " + err.code + " - " + err.message);
                        if (storageIsEnabled)
                            me.onPersistTrackingCallback(trackingMessage);
                    }
                    else if (res.statusCode >= 200 && res.statusCode < 300) {
                    }
                    else if (res.statusCode == 401) {
                        me.onQueueDebugCallback("Expired tracking token. Updating token...");
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
    IBMIOT.prototype.Update = function (settings) {
        IBMIOTMessagingToken = settings.messagingToken;
        IBMIOTTrackingToken = settings.trackingToken;
    };
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
                        me.onQueueErrorSubmitCallback("URL: " + acquireTokenUri);
                        callback(null);
                    }
                });
        }
        catch (err) {
            process.exit(1);
        }
    };
    IBMIOT.prototype.IsConnected = function () {
        return client.isConnected();
    };

}
module.exports = IBMIOT;