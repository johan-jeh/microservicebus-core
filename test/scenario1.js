'use strict'; /* global describe, it */

var path = require('path');
var initialArgs = process.argv[1];
process.argv[1] = path.resolve(__dirname, "../start.js");
var mocha = require('mocha');
var expect = require('chai').expect;
var assert = require('assert');
var request = require('supertest');
var should = require('should');
var fs = require('fs');
var SCRIPTFOLDER = path.resolve(process.env.HOME, "microServiceBus/services");
var util;
var MicroServiceBusHost;
var SettingsHelper;
var settingsHelper;
var orgId;
var nodeKey;
var signedIn = false;
var settings;
var loggedInComplete1;
var microServiceBusHost;

describe('Util functions', function () {

    it('padRight should work', function (done) {
        util = require("../lib/utils.js");
        var t = util.padRight("microServiceBus.com", 25, ' ');
        expect(t).to.equal("microServiceBus.com      ");
        done();
    });
    it('padLeft should work', function (done) {

        var t = util.padLeft("microServiceBus.com", 25, ' ');
        expect(t).to.equal("      microServiceBus.com");
        done();
    });
    it('addNpmPackage (msbcam) should work', function (done) {
        this.timeout(30000);
        util.addNpmPackage("msbcam", function (err) {
            expect(err).to.equal(null);
            done();
        });
    });
    it('compare same version should work', function (done) {

        var r = util.compareVersion("1.0.0", "1.0.0");
        expect(r).to.equal(0);
        done();
    });
    it('compare greater version should work', function (done) {

        var r = util.compareVersion("1.0.0", "1.0.1");
        expect(r).to.equal(-1);
        done();
    });
    it('compare earlier version should work', function (done) {

        var r = util.compareVersion("1.0.2", "1.0.1");
        expect(r).to.equal(1);
        done();
    });

});

describe('Encryption/Decryption', function () {
    var dataToEncrypt = "Some data";
    var encryptedBuffer;

    it('Encryption should work', function (done) {

        var dataToEncrypt = "Some data";
        encryptedBuffer = util.encrypt(new Buffer(dataToEncrypt), "secret");
        done();
    });
    it('Decryption should work', function (done) {

        var decryptedBuffer = util.decrypt(encryptedBuffer, "secret");
        var str = decryptedBuffer.toString('utf8');

        if (str != dataToEncrypt)
            throw "Encryption/Decryption failed";

        done();
    });
});

describe('Check configuration', function () {
    it('ENV organizationId should be set', function (done) {
        orgId = process.env.organizationId;
        console.log('organizationId: ' + orgId);
        expect(orgId).to.not.be.null;

        done();
    });
    it('ENV nodeKey should be set', function (done) {
        nodeKey = process.env.nodeKey;
        console.log('nodeKey: ' + nodeKey);

        expect(nodeKey).to.not.be.null;

        done();
    });
});

describe('Sign in', function () {
    it('Save settings should work', function (done) {
        SettingsHelper = require("./SettingsHelper.js");
        settingsHelper = new SettingsHelper();
        settings = {
            "hubUri": "wss://stage.microservicebus.com",
            "trackMemoryUsage": 0,
            "enableKeyPress": false,
            "useEncryption": false,
            "log": "",
            "nodeName": "unitTestNode1",
            "organizationId": orgId,
            "machineName": "unitTestNode1",
            "id": "644424d1-b591-4fd0-b7c2-29736b2f51ac",
            "sas": nodeKey,
            "port": 9090
        };
        settingsHelper.settings = settings;
        settingsHelper.save();
        done();
    });
    it('Create microServiceBus Node should work', function (done) {
        try {
            loggedInComplete1 = false;
            MicroServiceBusHost = require("../lib/MicroServiceBusHost.js");
            microServiceBusHost = new MicroServiceBusHost(settingsHelper);
            microServiceBusHost.SetTestParameters();
            expect(microServiceBusHost).to.not.be.null;
            done();
        }
        catch (err) {
            expect(err).to.be.null;
            done();
        }
    });
    it('Sign in should work', function (done) {
        this.timeout(60000);
        microServiceBusHost.OnStarted(function (loadedCount, exceptionCount) {
            if (!signedIn) {
                expect(exceptionCount).to.eql(0);
                expect(loadedCount).to.eql(1);
                signedIn = true;
                done();

            }

        });
        microServiceBusHost.OnStopped(function () {

        });
        try {
            microServiceBusHost.Start();

        }
        catch (er) {
            expect(er).to.be.null;
            done();
        }

    });
    it('Enable tracking should work', function (done) {
        this.timeout(60000);
        var r = microServiceBusHost.TestOnChangeTracking(function (enabledTracking) {
            expect(enabledTracking).to.equal(true);
            done();
        });
    });
    it('Report state should work', function (done) {
        this.timeout(60000);
        var r = microServiceBusHost.TestOnReportState(function (sucess) {
            expect(sucess).to.equal(true);
            done();
        });
    });
    it('Upload syslogs should work', function (done) {
        this.timeout(60000);
        var r = microServiceBusHost.TestOnUploadSyslogs(function (sucess) {
            expect(sucess).to.equal(true);
            done();
        });
    });
    it('Ping should work', function (done) {
        this.timeout(60000);
        var r = microServiceBusHost.TestOnPing("test");
        expect(r).to.equal(true);
        done();
    });
    it('Change Debug state should work', function (done) {
        this.timeout(60000);
        microServiceBusHost.TestOnChangeDebug(function (success) {
            expect(success).to.equal(true);
            done();

        });
    });
});

describe('Post Signin', function () {
    it('azureApiAppInboundService.js should exist after login', function (done) {
        var filePath = path.resolve(SCRIPTFOLDER, "azureApiAppInboundService.js");
        var ret = fs.statSync(filePath);
        ret.should.be.type('object');

        done();
    });
    it('calling test should work', function (done) {
        this.timeout(5000);
        var url = 'http://localhost:9090';

        request(url)
            .get('/api/data/azureApiAppInboundService1/test')
            .expect('Content-Type', 'application/json; charset=utf-8')
            .expect(200)//Status code
            .end(function (err, res) {
                if (err) {
                    throw err;
                }
                res.body.should.have.property('result');
                res.body.result.should.equal(true);
                console.log("GET Complete");
                //done();
                request(url)
                    .delete('/api/data/azureApiAppInboundService1/test')
                    .expect('Content-Type', 'application/json; charset=utf-8')
                    .expect(200)//Status code
                    .end(function (err, res) {
                        if (err) {
                            throw err;
                        }
                        res.body.should.have.property('result');
                        res.body.result.should.equal(true);
                        console.log("DELETE Complete");
                        request(url)
                            .post('/api/data/azureApiAppInboundService1/test')
                            .send({ name: 'Manny', species: 'cat' })
                            .expect('Content-Type', /json/)
                            .expect(200)//Status code
                            .end(function (err, res) {
                                if (err) {
                                    throw err;
                                }
                                res.body.should.have.property('result');
                                res.body.result.should.equal(true);
                                console.log("POST Complete");
                                request(url)
                                    .put('/api/data/azureApiAppInboundService1/test')
                                    .send({ name: 'Manny', species: 'cat' })
                                    .expect('Content-Type', /json/)
                                    .expect(200)//Status code
                                    .end(function (err, res) {
                                        if (err) {
                                            throw err;
                                        }
                                        res.body.should.have.property('result');
                                        res.body.result.should.equal(true);
                                        console.log("PUT Complete");
                                        done();
                                    });
                            });
                    });
            });
    });
    it('javascriptaction.js should exist after calling service', function (done) {
        var filePath = path.resolve(__dirname, SCRIPTFOLDER, "javascriptaction.js");

        var ret = fs.statSync(filePath);
        ret.should.be.type('object');
        done();
    });
    it('ping should work', function (done) {
        var pingResponse = microServiceBusHost.TestOnPing("");
        pingResponse.should.equal(true);
        done();
    });
    
    it('change state should work', function (done) {
        var TestOnChangeDebugResponse = microServiceBusHost.TestOnChangeState("Stop");
        done();
    });
    it('removeNpmPackage (msbcam) should work', function (done) {
        this.timeout(30000);
        util.removeNpmPackage("msbcam", function (err) {
            expect(err).to.be.null;
            done();
        });
    });
    it('Sign out should work', function (done) {
        done();
        setTimeout(function () { process.exit(99); }, 1000);
    });
}); 
