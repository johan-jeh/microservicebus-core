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
var exports = module.exports = {};
var fs = require('fs');
var npm = require('npm');
var path = require("path");
var crypto = require('crypto');
var algorithm = 'aes-256-ctr';
require('colors');
var rootFolder = process.arch == 'mipsel' ? '/mnt/sda1' : __dirname;
var npmFolder = process.arch == 'mipsel' ? '/mnt/sda1' : __dirname + "/../node_modules";

exports.padLeft = function (nr, n, str) {
    if (nr.length > n)
        nr = nr.substring(0, n);

    return Array(n - String(nr).length + 1).join(str || '0') + nr;
};

exports.padRight = function (nr, n, str) {
    if (nr != undefined && nr.length > n)
        nr = nr.substring(0, n);

    return nr + Array(n - String(nr).length + 1).join(str || '0');
};

exports.saveSettings = function (settings, done) {
    var fileName = rootFolder + "/settings.json";
    fs.writeFile(fileName, JSON.stringify(settings, null, 4), function (err) {
        if (err) {
            console.log(err);
        }
        if (done)
            done();
    });
};

fs.mkdirRecursive = function (dirPath, mode, callback) {
    //Call the standard fs.mkdir
    fs.mkdir(dirPath, mode, function (error) {
        // When it fail in this way, do the custom steps
        if (error && error.errno === 34) {
            //Create all the parents recursively
            fs.mkdirParent(path.dirname(dirPath), mode, callback);
            //And then the directory
            fs.mkdirParent(dirPath, mode, callback);
        }
        //Manually run the callback since we used our own callback to do all these 
        callback && callback(error); // jshint ignore:line
    });
};

exports.mkdir = function (dir, callback) {
    fs.mkdirParent(dir, null, callback);
};

exports.encrypt = function (buffer, password) {
    password = password == undefined ? process.env["NODESECRET"] : password;
    if (password == undefined) {
        throw "Node is configured to use encryption, but no secret has been configured. Add an environment variable called 'NODESECRET and set the value to your secret.".bgRed;
    }

    var cipher = crypto.createCipher(algorithm, password)
    var crypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return crypted;
}

exports.decrypt = function (buffer, password) {
    password = password == undefined ? process.env["NODESECRET"] : password;
    if (password == undefined) {
        throw "Node is configured to use encryption, but no secret has been configured. Add an environment variable called 'NODESECRET and set the value to your secret.".bgRed;
    }
    var algorithm = 'aes-256-ctr';
    var decipher = crypto.createDecipher(algorithm, password)
    var dec = Buffer.concat([decipher.update(buffer), decipher.final()]);
    return dec;
}

exports.addNpmPackage = function (npmPackage, callback) {
    var ret;
    var me = this;
    var options = { loaded: true };
    if (process.env["SNAP_USER_DATA"]) {
        let prefixPath = path.resolve(process.env["MSB_NODEPATH"], "..");
        console.log("Adding NPM package to %s", prefixPath);
        options.prefix = prefixPath;
    }
    npm.load(options, function (err) {
        var packageFolder = path.resolve(npm.dir, npmPackage)
        fs.stat(packageFolder, function (er, s) {
            if (er || !s.isDirectory()) {
                npm.commands.install([npmPackage], function (er, data) {
                    callback(er);
                });
                npm.on("log", function (message) {
                    ret = null;
                });
                npm.on("error", function (error) {
                    ret = null;
                });
            }
            else {
                callback(null);
            }
        });
    });
};

exports.addNpmPackages = function (npmPackages, logOutput, callback) {
    var ret;
    var me = this;
    var options = { loaded: true };
    if (process.env["SNAP_USER_DATA"]) {
        let prefixPath = path.resolve(process.env["MSB_NODEPATH"], "..");
        //console.log("Adding NPM package to %s", prefixPath);
        options.prefix = prefixPath;
    }

    npm.load(options, function (err) {
        // All packages
        var packages = npmPackages.split(',');
        var newPackages = [];

        for (var i = 0; i < packages.length; i++) {
            var npmPackage = packages[i];

            var segments = npmPackage.split('@');
            var name = segments[0];
            var version = segments.length > 1 ? segments[1] : "";

            try {
                require(name);

                // Check if package exists, but version is wrong
                if (version) {
                    var packageFolder = path.resolve(npm.dir, name);
                    var pjson = require(packageFolder + '/package.json');
                    if (pjson.version !== version) {
                        newPackages.push(npmPackage);
                    }
                }
            }
            catch (e) {
                newPackages.push(npmPackage);
            }
        }

        if (newPackages.length == 0)
            callback(null);
        else {
            try {
                npm.commands.install(newPackages, function (er, data) {
                    callback(er);
                });
                npm.on("log", function (message) {
                    ret = null;
                });
                npm.on("error", function (error) {
                    ret = null;
                });
            }
            catch (ex) {
                callback(ex);
            }
        }
    });
};

exports.removeNpmPackage = function (npmPackage, callback) {
    var ret;
    var me = this;
    var options = { loaded: true };
    if (process.env["SNAP_USER_DATA"]) {
        let prefixPath = path.resolve(process.env["MSB_NODEPATH"], "..");
        console.log("Adding NPM package to %s", prefixPath);
        options.prefix = prefixPath;
    }
    npm.load(options, function (err) {
        npm.commands.remove([npmPackage], function (err, data) {
            callback(err);
        });
    });
};

exports.compile2 = function (dir, callback) {
    var options = { loaded: true, 'unsafe-perm': true };
    npm.load(options, function (err) {
        npm.on("log", function (message) {
            console.log("mSB: COMPILE: " + message);
        });
        npm.on("error", function (error) {
            console.log("mSB: COMPILE - ERROR: " + error);
        });
        npm.commands.install(dir, [], function (err, data) {
            callback(err, data);
        })

    });
};

exports.compile = function  (dir, callback) {

    var exec = require('child_process').exec;
    exec("cd $SNAP_USER_DATA; npm install " + dir + " --unsafe-perm", function (error, stdout, stderr) { 
        console.log(stdout);
        console.log(stderr);
        callback(error, 1);

    });
};

exports.compareVersion = function (a, b) {
    var i;
    var len;

    if (typeof a + typeof b !== 'stringstring') {
        return false;
    }

    a = a.split('.');
    b = b.split('.');
    i = 0;
    len = Math.max(a.length, b.length);

    for (; i < len; i++) {
        if ((a[i] && !b[i] && parseInt(a[i]) > 0) || (parseInt(a[i]) > parseInt(b[i]))) {
            return 1;
        } else if ((b[i] && !a[i] && parseInt(b[i]) > 0) || (parseInt(a[i]) < parseInt(b[i]))) {
            return -1;
        }
    }

    return 0;
};

exports.reboot = function (a, b) {
    var sys = require('util')
    var exec = require('child_process').exec;
    function puts(error, stdout, stderr) { sys.puts(stdout) }
    exec("reboot", puts);
};

exports.getDependanciesRecursive = function (callback) {

    var options = { loaded: true };

    var npm = require('npm');
    npm.load(options, function (err) {
        npm.commands.list(function (err, data) {
            var list = [];
            if (!data.dependencies)
                callback(err, list);
            else { }
            list = getDependancies(data.dependencies, []);
            list = list.filter(function (value, index, self) {
                return self.indexOf(value) === index;
            });

            callback(null, list);

        });
    });

    let getDependancies = function (dependencies, list) {
        let depList = [];
        try {
            for (var p in dependencies) {
                if (dependencies.hasOwnProperty(p)) {
                    console.log(p);

                    depList.push({ name: dependencies[p].name, version: dependencies[p].version })
                    list = getDependancies(dependencies[p].dependencies, list);
                }
            }
        }
        catch (err) { }
        return list.concat(depList);
    }
};