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
var storage = require('node-persist');
var guid = require('uuid');
var fs = require('fs');
var path = require('path');
var util = require('./utils.js');

function PersistHelper(settingsHelper) {
    
    var options = {
        dir: settingsHelper.persistDirectory,
        stringify: JSON.stringify,
        parse: JSON.parse,
        encoding: 'utf8',
        logging: false,  // can also be custom logging function 
        continuous: true, // continously persist to disk 
        interval: false, // milliseconds, persist to disk on an interval 
        ttl: settingsHelper.retentionPeriod ? settingsHelper.retentionPeriod * 1000 : 0, // ttl* [NEW], can be true for 24h default or a number in MILLISECONDS 
        expiredInterval: settingsHelper.retentionPeriod ? settingsHelper.retentionPeriod * 1000 : 0, // [NEW] every 2 minutes the process will clean-up the expired cache 
        // in some cases, you (or some other service) might add non-valid storage files to your 
        // storage dir, i.e. Google Drive, make this true if you'd like to ignore these files and not throw an error 
        forgiveParseErrors: true // [NEW] 
    };
    // fs.readdir(options.dir, function (err, files) {
    //     files.forEach(function (file, index) {
    //         fs.stat(path.join(options.dir, file), function (err, stat) {
    //             var endTime, now;
    //             if (err) {
    //                 return console.error(err);
    //             }
    //             now = new Date().getTime();
    //             endTime = new Date(stat.ctime).getTime() + options.ttl;
    //             if (now > endTime) {
    //                 return fs.unlinkSync(path.join(options.dir, file));
    //             }
    //         });
    //     });
    // });
    storage.initSync(options);

    this.persist = function (obj, type, callback) {
        util.getAvailableDiskspaceRaw(function (err, storeageState) {
            if (err) {
                callback("Unable to read number of files in persist folder");
            }
            else {
                if ((storeageState.available / storeageState.total) * 100 > 25) {
                    switch (type) {
                        case "history":
                            if (settingsHelper.retentionPeriod && settingsHelper.retentionPeriod > 0) {
                                storage.setItem('_h_' + new Date().toISOString(), obj).then(function (data, err) {
                                    callback();
                                });
                            }
                            break;
                        case "event":
                            storage.setItem('_e_' + guid.v1(), obj, { ttl: false }).then(function (data, err) {
                                callback();
                            });
                            break;
                        case "message":
                            storage.setItem('_m_' + guid.v1(), obj, { ttl: false }).then(function (data, err) {
                                callback();
                            });
                            break;
                        case "tracking":
                            storage.setItem('_t_' + guid.v1(), obj, { ttl: false }).then(function (data, err) {
                                callback();
                            });
                            break;
                        default:
                            console.log('Unsuported storage type');
                            break;
                    }
                }
                else {
                    callback("Unable to persist message due to folder size");
                }
            }
        });
    };
    this.remove = function (key) {
        storage.removeItem(key, function (err) {
            //console.log();
        });
    };
    this.forEach = function (callback) {
        return storage.keys().forEach(function (key) {
            callback(key, storage.getDataValue(key));
        }.bind(this));
    };

}

module.exports = PersistHelper;