var binary =        require('binary');
var net =           require('net');
var EventEmitter =  require('events').EventEmitter;
var util =          require('util');
var async =         require('async');

var binrpc =        require('./protocol.js');

/**
 * @class Server
 * @param {object} options containing a host and port attribute
 */
/** @exports server */
var Server = function (options) {
    var that = this;
    this.host = options.host;
    this.port = options.port;
    this.server = net.createServer(function (client) {
        var receiver = new Buffer(0);
        var chunk = 0;
        var length;

        client.on('error', function (e) {
            //console.log('error ' + name + ' ' + JSON.stringify(e));
        });

        client.on('end', function () {
            //console.log('<-- ' + name + ' disconnected');
        });

        client.on('data', function (data) {
            if (chunk == 0) {
                // request header
                var vars = binary.parse(data)
                    .buffer('head', 3)
                    .word8('msgType')
                    .word32bu('msgSize')
                    .vars;
                length = vars.msgSize;
                receiver = data;
            } else {
                // append request data
                receiver = Buffer.concat([receiver, data]);
            }

            chunk += 1;

            if (receiver.length >= (length + 8)) {
                // request complete
                var request = binrpc.decodeRequest(receiver);

                receiver = new Buffer(0);
                chunk = 0;

                that.handleCall(request, client);

            }

        });

    });

    this.server.listen(this.port, this.host, function () {
        //console.log('listening on ' + that.port);
    });

    this.handleCall = function (request, client) {
        if (request.method === 'system.multicall') {

            // make WORKING datapoint first element
            // TODO does this make sense? WORKING and LEVEL are not always in the same multicall - so this must be handled on a higher level anyway...

            for (var i = 0; i < request.params[0].length; i++) {
                if (request.params[0][i].params[2] === 'WORKING') {
                    request.params[0][0] = request.params[0].splice(i, 1, request.params[0][0])[0];
                }
            }

            async.map(request.params[0], that.handleSingleCall, function (err, response) {
                var buf = response ? binrpc.encodeResponse(response) : binrpc.encodeResponse('');
                client.write(buf);
            });
        } else {
            that.handleSingleCall({methodName: request.method, params: request.params}, function (err, response) {
                var buf = response ? binrpc.encodeResponse(response) : binrpc.encodeResponse('');
                client.write(buf);
            });
        }
    };

    this.handleSingleCall = function (obj, callback) {
        var method = obj.methodName;
        var params = obj.params;

        /**
         * Fires when RPC method call is received
         *
         * @event Server#[method]
         * @param {*} error
         * @param {array} params
         * @param {function} callback callback awaits params err and response
         */
        var res = that.emit(method, null, params, function (err, response) {
            callback(null, response || '');
        });

        if (!res) {
            /**
             * Fires if a RPC method call has no event handler.
             * RPC response is always an empty string.
             *
             * @event Server#NotFound
             * @param {string} method
             * @param {array} params
             */
            that.emit('NotFound', method, params);
            callback(null, '');
        }
    };

};

util.inherits(Server, EventEmitter);

module.exports = Server;
