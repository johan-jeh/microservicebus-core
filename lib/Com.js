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
var crypto = require('crypto');
var httpRequest = require('request');
var util = require('./utils.js');
var extend = require('extend');
var moment = require('moment');
var fs = require('fs');
var guid = require('uuid');
var storageIsEnabled = true;

function Com(nodeName, sbSettings, hubUri, settingsHelper) {
    var me = this;

    sbSettings.sbNamespace = sbSettings.sbNamespace + '.servicebus.windows.net';
    //DEPRECATED
    
    this.dissconnectedSince = null;
    this.receivedQueueErrorCount = 0;
    this.settingsHelper = settingsHelper;
    this.onMessageReceivedCallback = null;
    this.onStateReceivedCallback = null;
    this.onQueueMessageReceivedCallback = null;
    this.onQueueErrorReceiveCallback = null;
    this.onQueueErrorSubmitCallback = null;
    this.onSubmitQueueErrorCallback = null;
    this.onDisconnectCallback = null;
    this.onQueueDebugCallback = null;
    this.onSubmitQueueSuccessCallback = null;
    this.onActionCallback = null;
    this.onUnauthorizedErrorCallback = null;
    this.onPersistEventCallback = null;
    this.onPersistMessageCallback = null;
    this.onPersistTrackingCallback = null;
    this.onPersistHistoryCallback = null;
    this.currentState = {
        desired: this.settingsHelper.settings.deviceState ? this.settingsHelper.settings.deviceState.desired : {},
        reported: this.settingsHelper.settings.deviceState ? this.settingsHelper.settings.deviceState.reported : {}
    };

    Com.prototype.OnPersistEventCallback = function (callback) {
        this.onPersistEventCallback = callback;
    };
    Com.prototype.OnPersistMessageCallback = function (callback) {
        this.onPersistMessageCallback = callback;
    };
    Com.prototype.OnPersistTrackingCallback = function (callback) {
        this.onPersistTrackingCallback = callback;
    };
    Com.prototype.OnPersistHistoryCallback = function (callback) {
        this.onPersistHistoryCallback = callback;
    };
    
    Com.prototype.OnMessageReceived = function (callback) {
        this.onMessageReceivedCallback = callback;
    };
    Com.prototype.OnStateReceived = function (callback) {
        this.onStateReceivedCallback = callback;
    };
    Com.prototype.OnQueueMessageReceived = function (callback) {
        this.onQueueMessageReceivedCallback = callback;
    };
    Com.prototype.OnReceivedQueueError = function (callback) {
        this.onQueueErrorReceiveCallback = callback;
        this.onQueueErrorSubmitCallback = callback;
    };
    Com.prototype.OnSubmitQueueError = function (callback) {
        this.onSubmitQueueErrorCallback = callback;
    };
    Com.prototype.OnDisconnect = function (callback) {
        this.onDisconnectCallback = callback;
    };
    Com.prototype.OnUnauthorizedError = function (callback) {
        this.onUnauthorizedErrorCallback = callback;
    };
    Com.prototype.OnSubmitQueueSuccess = function (callback) {
        this.onSubmitQueueSuccessCallback = callback;
    };
    Com.prototype.OnQueueDebugCallback = function (callback) {
        this.onQueueDebugCallback = callback;
    };
    Com.prototype.OnActionCallback = function (callback) {
        this.onActionCallback = callback;
    };

    Com.prototype.Start = function () {
    };
    Com.prototype.Stop = function () {
    };
    Com.prototype.Submit = function (message, node, service) {
    };
    Com.prototype.SubmitEvent = function (message, service, properties) {
    };
    Com.prototype.ChangeState = function (state, node) {
        console.log("Com::ChangeState - NOT IMPLEMENTED FOR IOT PROVIDER!");
    };
    Com.prototype.Track = function (trackingMessage) {
    };
    Com.prototype.Update = function (settings) {
    };
    Com.prototype.IsConnected = function () {
        return true;
    };

    var Protocol = require('./protocols/' + sbSettings.protocol + '.js');
    var protocol = new Protocol(nodeName, sbSettings);
    protocol.hubUri = hubUri;

    extend(this, protocol);
}
module.exports = Com;