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
function Orchestrator() {
    var self = this;
    this.onLog = null;

    this.OnLogCallback = function (callback) {
        this.onLog = callback;
    };
    // Returns the next services in line to be executed.
    this.getSuccessors = function (integrationMessage) {
        return new Promise(function(resolve, reject) {
            var itinerary = integrationMessage.Itinerary;
            var serviceName = integrationMessage.LastActivity;
            var lastActionId = itinerary.activities.find(function (action) { return action.userData.id === serviceName; }).id;

            var connections = itinerary.activities.filter(function (connection) {
                return connection.source !== undefined &&
                    connection.source.node !== undefined &&
                    connection.source.node === lastActionId &&
                    (connection.type === 'draw2d.Connection' || connection.type === 'LabelConnection');
            });

            var successors = [];

            connections.forEach(function (connection) {
                if (connection.source.node == lastActionId) {
                    var successor = itinerary.activities.find(function (action) { return action.id === connection.target.node; });

                    var isEnabled = successor.userData.config.generalConfig.find(function (c) { return c.id === 'enabled'; }).value;

                    if (isEnabled){
                        self.validateRoutingExpression(successor, integrationMessage)
                        .then(function(ret){
                            if(ret){
                                let destination = successor.userData.config.generalConfig.find(function (c) { return c.id === 'host'; }).value;
                                successor.userData.host = destination;
                                successors.push(successor);
                            }
                            else{
                                resolve();
                            }
                        })
                        .catch(function(err){
                            reject(err);
                        });
                    }
                    else{
                        resolve();
                    }
                }
            });

            resolve(successors);
        });
    };
    // Evaluates the routing expression
    this.validateRoutingExpression = function (actitity, integrationMessage) {
        return new Promise(function(resolve, reject) {
            var expression;
            try {
                var routingExpression = actitity.userData.config.staticConfig.find(function (c) { return c.id === 'routingExpression'; });
                if (routingExpression == null) // jshint ignore:line
                resolve(true);

                var messageString = '{}';
                if (integrationMessage.ContentType == 'application/json') {
                    var buf = new Buffer(integrationMessage._messageBuffer, 'base64');
                    messageString = buf.toString('utf8');
                }
                // Add variables
                var varialbesString = '';
                if (integrationMessage.Variables != null) { // jshint ignore:line
                    integrationMessage.Variables.forEach(function (variable) {
                        switch (variable.Type) {
                            case 'String':
                            case 'DateTime':
                                varialbesString += 'var ' + variable.Variable + ' = ' + "'" + variable.Value + "';\n";
                                break;
                            case 'Number':
                            case 'Decimal':
                                varialbesString += 'var ' + variable.Variable + ' = ' + variable.Value + ";\n";
                                break;
                            case 'Message':
                                var objString = JSON.stringify(variable.Value);
                                varialbesString += 'var ' + variable.Variable + ' = ' + objString + ";\n";
                                break;
                            default:
                                break;
                        }
                    });
                }
                routingExpression.value = routingExpression.value.replace("var route =", "route =");
                expression = '"use strict"; var message =' + messageString + ';\n' + varialbesString + routingExpression.value;

                var route;
                var o = eval(expression); // jshint ignore:line
                resolve(route);
            }
            catch (ex) {
                reject("Unable to run script: " + expression);
            }
        });
    };
}
module.exports = Orchestrator; 