/*jslint node: true */
"use strict";

var constants = require('../config/constants.js');
// var conf = require('../config/conf.js');
var db = require('../db/db.js');

var validationUtils = require("../validation/validation_utils.js");
var objectHash = require('../base/object_hash.js');
var round = require('../pow/round.js');

/**
 *	verify if a deposit definition is valid.
 *
 * 	@param	{Array}	arrDefinition
 *	@return	{boolean}
 */
function isDepositDefinition(arrDefinition){
    if (!validationUtils.isArrayOfLength(arrDefinition, 2))
        return false;
    if (arrDefinition[0] !== 'or')
        return false;
    if (!validationUtils.isArrayOfLength(arrDefinition[1], 2))
        return false;
    if (!validationUtils.isArrayOfLength(arrDefinition[1][0], 2))
        return false;
    if (!validationUtils.isArrayOfLength(arrDefinition[1][1], 2))
        return false;
    if (arrDefinition[1][0][1] !== constants.FOUNDATION_SAFE_ADDRESS)
        return false;
    if(!validationUtils.isValidAddress(arrDefinition[1][1][1]))
        return false;
    
    return true;    
}

/**
 *	Check if an address has sent invalid unit.
 *
 * 	@param	{obj}	    conn      if conn is null, use db query, otherwise use conn.
 * 	@param	{string}	address
 * 	@param	{function}	cb( err, hasInvalidUnits ) callback function
 *              If there's error, err is the error message and hasInvalidUnits is null.
 *              If there's no error and there's invalid units, then hasInvalidUnits is true, otherwise false.
 */
function hasInvalidUnitsFromHistory(conn, address, cb){
    var conn = conn || db;
    if(!validationUtils.isNonemptyString(address))
        return cb("param address is null or empty string");
    if(!validationUtils.isValidAddress(address))
        return cb("param address is not a valid address");
    conn.query(
        "SELECT address FROM units JOIN unit_authors USING(unit)  \n\
        WHERE is_stable=1 AND sequence!='good' AND address=?", 
        [address],
        function(rows){
            cb(null, rows.length > 0 ?  true : false);
        }
    );
}

/**
 * Returns deposit address stable balance, Before the roundIndex
 * 
 * @param	{obj}	    conn      if conn is null, use db query, otherwise use conn.
 * @param   {String}    depositAddress
 * @param   {String}    roundIndex
 * @param   {function}	cb( err, balance ) callback function
 *                      If address is invalid, then returns err "invalid address".
 *                      If address is not a deposit, then returns err "address is not a deposit".
 *                      If can not find the address, then returns err "address not found".
 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
 */
function getBalanceOfDepositContract(conn, depositAddress, roundIndex, cb){
    var conn = conn || db;
    if(!validationUtils.isNonemptyString(depositAddress))
        return cb("param depositAddress is null or empty string");
    if(!validationUtils.isValidAddress(depositAddress))
        return cb("param depositAddress is not a valid address");
    if(!validationUtils.isPositiveInteger(roundIndex))
        return cb("param roundIndex is not a positive integer");
    if(roundIndex === 1)
        return cb(null, 0);
    //WHERE src_unit=? AND src_message_index=? AND src_output_index=? \n\
    round.getMaxMciByRoundIndex(conn, roundIndex-1, function(lastRoundMaxMci){
        var sumBanlance = 0;
        conn.query("SELECT src_unit, src_message_index, src_output_index AS count \n\
            FROM inputs JOIN units USING(unit) \n\
            WHERE asset IS NULL AND main_chain_index>? AND address=?", 
        [lastRoundMaxMci, depositAddress], 
        function(rowsInputs) {
            conn.query("SELECT unit, is_spent, amount, message_index, output_index \n\
                FROM outputs JOIN units USING(unit) \n\
                WHERE asset IS NULL AND main_chain_index<=? AND address=?", 
            [lastRoundMaxMci, depositAddress], 
            function(rowsOutputs) {
                if (rowsOutputs.length === 0)
                    return cb(null, 0);
                for (var i=0; i<rowsOutputs.length; i++) {
                    if(rowsOutputs[i].is_spent === 0) {
                        sumBanlance += rowsOutputs[i].amount;
                    }
                    else {
                        if(rowsInputs.length > 0) {
                            for (var j=0; j<rowsInputs.length; j++) {
                                if(rowsInputs[j].src_unit === rowsOutputs[i].unit && rowsInputs[j].src_message_index === rowsOutputs[i].message_index && rowsInputs[j].src_output_index === rowsOutputs[i].output_index ){
                                    sumBanlance += rowsOutputs[i].amount;
                                }
                            }
                        }                        
                    }
                }
                cb(null, sumBanlance);
            });
        });
    });
}

/**
 * Returns deposit address by supernode address.
 * 
 * @param	{obj}	    conn      if conn is null, use db query, otherwise use conn.
 * @param   {String}    supernodeAddress
 * @param   {function}	cb( err, depositAddress ) callback function
 *                      If address is invalid, then returns err "invalid address".
 *                      If can not find the address, then returns err "depositAddress not found".
 */
function getDepositAddressBySupernode(conn, supernodeAddress, cb){
    var conn = conn || db;
    if(!validationUtils.isNonemptyString(supernodeAddress))
        return cb("param supernodeAddress is null or empty string");
    if(!validationUtils.isValidAddress(supernodeAddress))
        return cb("param supernodeAddress is not a valid address");
    const arrDefinition = [
        'or', 
        [
            ['address', constants.FOUNDATION_SAFE_ADDRESS],
            ['address', supernodeAddress],
        ]
    ];
    const depositAddress = objectHash.getChash160(arrDefinition)
    conn.query("SELECT definition FROM shared_addresses WHERE shared_address = ?", [depositAddress], 
        function(rows) {
            if (rows.length !== 1 )
                return cb("depositAddress is not found");
            cb(null, depositAddress);
    });
}

/**
 * Returns supernode address by deposit address.
 * 
 * @param	{obj}	    conn      if conn is null, use db query, otherwise use conn.
 * @param   {String}    depositAddress
 * @param   {function}	cb( err, supernodeAddress ) callback function
 *                      If depositAddress is invalid, then returns err "invalid address".
 *                      If can not find the address, then returns err "supernodeAddress not found".
 */
function getSupernodeByDepositAddress(conn, depositAddress, cb){
    var conn = conn || db;
    if(!validationUtils.isNonemptyString(depositAddress))
        return cb("param depostiAddress is null or empty string");
    if(!validationUtils.isValidAddress(depositAddress))
        return cb("param depostiAddress is not a valid address");

    conn.query("SELECT address, safe_address FROM supernode WHERE deposit_address = ?", [depositAddress], 
        function(rows) {
            if (rows.length !== 1 )
                return cb("supernodeAddress is not found");
            cb(null, rows);
    });
}

/**
 * Create Deposit Address
 * @param {String} my_address - address that use to generate deposit address
 * @param {Array} arrDefinition - definiton of miner shared address
 * @param {Object} assocSignersByPath - address paths of shared address
 * @param {Function} callback - callback(deposit_address)
 */
function createDepositAddress(my_address, callback) {
	var walletDefinedByAddresses = require('../wallet/wallet_defined_by_addresses.js');
	var device = require('../wallet/device.js');
	

	var myDeviceAddresses = device.getMyDeviceAddress();

	var arrDefinition = [
		'or', 
		[
			['address', constants.FOUNDATION_SAFE_ADDRESS],
			['address', my_address],
		]
	];
	
	var assocSignersByPath={
		'r.0.0': {
			address: constants.FOUNDATION_ADDRESS,
			member_signing_path: 'r',
			device_address: constants.FOUNDATION_DEVICE_ADDRESS
		},
		'r.1.0': {
			address: my_address,
			member_signing_path: 'r',
			device_address: myDeviceAddresses
		},
	};
	var shared_address = objectHash.getChash160(arrDefinition)

	walletDefinedByAddresses.handleNewSharedAddress({address: shared_address, definition: arrDefinition, signers: assocSignersByPath}, callback)
}

exports.isDepositDefinition = isDepositDefinition;
exports.hasInvalidUnitsFromHistory = hasInvalidUnitsFromHistory;
exports.getBalanceOfDepositContract = getBalanceOfDepositContract;
exports.getDepositAddressBySupernode = getDepositAddressBySupernode;
exports.getSupernodeByDepositAddress = getSupernodeByDepositAddress;

exports.createDepositAddress = createDepositAddress;
