// 'use strict'; /* global describe, it */

// var path = require('path');
// var initialArgs = process.argv[1];
// process.argv[1] = path.resolve(__dirname, "../start.js");
// var mocha = require('mocha');
// var expect = require('chai').expect;
// var assert = require('assert');
// var request = require('supertest');
// var should = require('should');
// var fs = require('fs');
// var SCRIPTFOLDER = path.resolve(process.env.HOME, "microServiceBus/services");
// var util;
// var MicroServiceBusHost;
// var SettingsHelper;
// var settingsHelper;
// var orgId;
// var nodeKey;
// var settings;
// var loggedInComplete1;
// var microServiceBusHost;


// describe('Sign in using white list should word', function () {
//     it('Save settings should work', function (done) {
//         SettingsHelper = require("./SettingsHelper.js");
//         settingsHelper = new SettingsHelper();
//         settings = {
//             "hubUri": "wss://stage.microservicebus.com",
//             "trackMemoryUsage": 0,
//             "enableKeyPress": false,
//             "useEncryption": false,
//             "log": ""
//         };
//         settingsHelper.settings = settings;
//         settingsHelper.save();
//         done();
//     });
//     it('Create microServiceBus Node should work', function (done) {
//         loggedInComplete1 = false;
//         MicroServiceBusHost = require("../lib/MicroServiceBusHost.js");
//         microServiceBusHost = new MicroServiceBusHost(settingsHelper);
//         expect(microServiceBusHost).to.not.be.null;
//         done();
//     });
//     it('Sign in should work', function (done) {
//         this.timeout(60000);
//         microServiceBusHost.OnStarted(function (loadedCount, exceptionCount) {
//             expect(exceptionCount).to.eql(0);
//             expect(loadedCount).to.eql(1);
//             done();
//         });
//         microServiceBusHost.OnStopped(function () {

//         });
//         microServiceBusHost.OnUpdatedItineraryComplete(function () {

//         });
//         try {
//             process.argv = [
//                 process.argv[0],
//                 path.resolve(__dirname, "../start.js"),
//                 "/w"
//             ]
//             microServiceBusHost.Start();

//         }
//         catch (er) {
//             expect(err).to.be.null;
//             done();
//         }

//     });
// });