/*jshint esnext: true */


function planscene() {
    //init
    if (!Memory.servers) {
       console.log("Initializing memory");
       Memory.servers = {};
    }
    var scene = {
        totalenergy: 0,
        totalcapacity: 0,
        harvesters: 0,
        carriers: 0,
        upgraders: 0,
        builders: 0,
        repairers: 0,
        idlers: 0,
        hostiles: [],
        hitsMax: 10000, //TODO: determine dynamically
        targets: {},
        parameters: {
            MAXDECAY: 0.2,
            MINRESERVE: 0.25, //minimum energy reserve
            DEBUG: true,
        }
    };

    //iterate over rooms (single room only for now)
    _.forEach(Game.rooms, room => {
        scene.room = room;
        scene.totalenergy += room.energyAvailable;
        scene.totalcapacity += room.energyCapacityAvailable;
        scene.creeps = room.find(FIND_MY_CREEPS);
        scene.hostiles = room.find(FIND_HOSTILE_CREEPS);
        scene.towers =  room.find(FIND_MY_STRUCTURES, { filter: structure => structure.structureType == STRUCTURE_TOWER });
        scene.creeps.forEach(creep => {
            if (!creep.memory.role) creep.memory.role = "idle";
            scene[creep.memory.role + 's']++;
        });
        scene.targets = {
            harvester: room.find(FIND_SOURCES_ACTIVE),
            builder: room.find(FIND_MY_CONSTRUCTION_SITES),
            upgrader: [room.controller],
            carrier: room.find(FIND_MY_STRUCTURES, { filter: structure => {
                return ((structure.energyCapacity) && (structure.energy < structure.energyCapacity));
            }}),
            repairer: room.find(FIND_MY_STRUCTURES, { filter: structure => {
                    return (structure.hitsMax) && (structure.hits < scene.hitsMax) && (structure.hits < (1- scene.parameters.MAXDECAY) * structure.hitsMax);
            }}),
            attacker: scene.hostiles
        };
        scene.demandrole = findrole(scene);
    });
    return scene;
}



function commission(creep, scene) {
    // commissions a creep to a target
    var target = null;
    if (creep.memory.target) {
        //we already have a target, set a new one
        target = Game.getObjectById(creep.memory.target);
        decommission(null, target, scene);
        target = null;
    }
    var potentialtargets = scene.targets[creep.memory.role];
    if (potentialtargets.length == 1) {
        //easy, only one target
        target = potentialtargets[0];
    } else if (potentialtargets.length > 1) {
        for (var key in _.sortBy(potentialtargets, t => creep.pos.getRangeTo(t))) {
            target = potentialtargets[key];
            if (creep.memory.role == "harvester") {
                if (!(target.id in Memory.servers) || (Memory.servers[target.id].length <= getaccessibility(target))) {
                    //servers not full yet, good, we take this one
                    break;
                }
            } else {
                //closest one suffices
                break;
            }
        }
    } else {
        return null;
    }
    //commission to the target
    creep.memory.target = target.id;
    if (!(target.id in Memory.servers) || (!Memory.servers[target.id])) {
        Memory.servers[target.id] = [creep.name];
    } else if (Memory.servers[target.id].indexOf(creep.name) === -1) {
        Memory.servers[target.id].push(creep.name);
    }
    if (scene.parameters.DEBUG) {
        console.log("Added " + creep.name + " to servers for " + target.id + " [" + target.name + "]: " + JSON.stringify(Memory.servers[target.id]))
    }
    return target;
}

function run(creep, scene) {
    var target;
    if (creep.memory.role == "idle") {
        creep.memory.role = newrole(creep, scene);
        if (scene.parameters.DEBUG) {
            console.log("Worker " + creep.name + " assumed role " + creep.memory.role);
            creep.say(creep.memory.role);
        }
    }
    if (creep.memory.role != "idle") {
        if (!creep.memory.target) {
            target = commission(creep, scene);
        } else {
            target = Game.getObjectById(creep.memory.target);
        }
        if (!target) {
            //we couldn't find a target, become idle
            console.log("Worker " + creep.name + " (" + creep.memory.role + ") can't find a target");
            creep.say("no target");
            creep.memory.role = "idle";
            return false;
        }
        if (creep.memory.role == "harvester") {
            harvester(creep, target, scene);
        } else if (creep.memory.role == "carrier") {
            carrier(creep, target, scene);
        } else if (creep.memory.role == "upgrader") {
            upgrader(creep, target, scene);
        } else if (creep.memory.role == "repairer") {
            console.log("TODO: implement repairer!")
        } else if (creep.memory.role == "builder") {
            console.log("TODO: implement builder!")
        }
        return true;
    }
}

function findrole(scene) {
    if ((scene.harvesters > 2) && (scene.upgraders < 1)) {
        //we have no upgrader
        return "upgrader";
    } else if ((scene.totalenergy < scene.parameters.MINRESERVE * scene.totalcapacity) || (scene.totalenergy < 300)) {
        //not enough reserves, carry for storage
        return "carrier";
    } else if ((scene.targets.repairer) && (scene.targets.repairer.length > 0)) {
        return "repairer";
    } else if ((scene.targets.builder) && (scene.targets.builder.length > 0)) {
        return "builder";
    }
    return "idle";
}

function newrole(creep, scene) {
    //assign a role for this creep
    if ((creep.carry) && (creep.carry.energy > 0)) {
        //we have energy to do something
        if (scene.demandrole == "idle") {
            return "upgrader";
        } else {
            return scene.demandrole;
        }
    } else {
        //we need energy for whatever we intend to do
        return "harvester";
    }
}

function spawnblueprint(scene) {
    if (scene.demandrole != "idle") {
        if ((scene.totalenergy >= scene.parameters.MINRESERVE * scene.totalcapacity) || (scene.totalEnergy == scene.totalcapacity)) {
            if (scene.totalcapacity > 600) {
                return  [WORK, CARRY,CARRY,MOVE,MOVE];
            } else {
                return [WORK, CARRY, MOVE];
            }
        }
    }
    return [];
}

function harvester(creep, target, scene) {
    var result = creep.harvest(target);
    if (result == OK) {
        if ((creep.carry.energy == creep.carryCapacity) || (target.energy == 0)) {
            if (scene.parameters.DEBUG) {
                console.log("Worker " + creep.name + " is done harvesting")
            }
            decommission(creep, target, scene);
        }
    } else if (result == ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {visualizePathStyle: {stroke: '#ffaa00'}});
    }
}


function upgrader(creep, target, scene) {
    var result = creep.upgradeController(target);
    if (result == ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {visualizePathStyle: {stroke: '#0000aa'}});
    } else if (result == ERR_FULL) {
        //find a new target
        commission(creep, scene);
    } else if (result != OK) {
        console.log("Unexpected result for carrier: " + result);
    }
    if (creep.carry.energy === 0) {
            if (scene.parameters.DEBUG) {
                console.log("Worker " + creep.name + " is done upgrading")
            }
        decommission(creep,target, scene);
    }
}

function carrier(creep, target, scene) {
    var result = creep.transfer(target, RESOURCE_ENERGY);
    if (result == OK)  {
        if (creep.carry.energy == 0) {
            if (scene.parameters.DEBUG) {
                console.log("Worker " + creep.name + " is done carrying")
            }
            decommission(creep, target, scene);
        }
    } else if (result == ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {visualizePathStyle: {stroke: '#0000aa'}});
    } else if (result == ERR_FULL) {
        //find a new target
        commission(creep, scene);
    } else {
        console.log("Unexpected result for carrier: " + result);
    }
    if (creep.carry.energy === 0) {
        decommission(creep,target, scene);
    }
}

function decommission(creep, target, scene) {
    if (typeof creep !== "object") {
        throw "decommission: creep is not an object";
    }
    if (typeof target !== "object") {
        throw "decommission: target is not an object";
    }
    if (creep) {
        if (scene.parameters.DEBUG) {
            console.log("Decommissioning " + creep.name)
        }
        creep.memory.target = null;
        if ((target.id in Memory.servers) && (Memory.servers[target.id])) {
            var index = Memory.servers[target.id].indexOf(creep.name);
            if (index > -1) {
                Memory.servers[target.id].splice(index,1);
                if (scene.parameters.DEBUG) {
                    console.log("Removed " + creep.name + " [" + creep.memory.role + "] from servers for " + target.id + " [" + target.name + "]: " + JSON.stringify(Memory.servers[target.id]))
                }
            }
        }
        creep.memory.role = "idle";
    } else if (target) {
        if (target.id in Memory.servers) {
            delete Memory.servers[target.id];
        }
        if (scene.parameters.DEBUG) {
            console.log("Removed target " + target.id + ": " + JSON.stringify(Memory.servers[target.id]));
        }
    }
}


function cleanup(scene) {
    //Garbage collection
    for(var name in Memory.creeps) {
        if(!Game.creeps[name]) {
            var target_id = Memory.creeps[name].target;
            if ((target_id) && (target_id in Memory.servers)) {
                if (target_id in Memory.servers) {
                    var index = Memory.servers[target_id].indexOf(name);
                    if (index > -1) {
                        Memory.servers[target_id].splice(index,1);
                        if (scene.parameters.DEBUG) {
                            console.log("[CLEANUP] Removed " + name + " from servers for " + target_id + " [" + target.name + "]: " + JSON.stringify(Memory.servers[target_id]))
                        }
                    }
                }
            }
            delete Memory.creeps[name];
        }
    }
    for(var obj in Memory.incoming) {
        if(!Game.getObjectById[obj]) {
            delete Memory.incoming[obj];
        }
    }
    for(var obj2 in Memory.accessibility) {
        if(!Game.getObjectById[obj2]) {
            delete Memory.accessibility[obj2];
        }
    }
}


function getaccessibility(target, scene) {
    if (target.id in Memory.accessibility) {
        return Memory.accessibility[target.id];
    }
    try {
        const terrain = new Room.Terrain(target.room);
        var result = 0;
        for (var x = -1; x <= 1; x++) {
            for (var y = -1; x <= 1; x++) {
                if (!((x === 0) && (y === 0))) {
                    result += (terrain.get(target.pos.x - x, target.pos.y - y) != TERRAIN_MASK_WALL);
                }
            }
        }
        Memory.accessibility[target.id] = result;
        return result;
    } catch (e) {
        if (target.id == "5bbcae729099fc012e639107") { //temporary cheat
            return 1
        } else {
            return 6;
        }
    }
}

function run_tower(tower, scene) {
    var closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (closestHostile) {
        tower.attack(closestHostile);
    } else {
        var closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (struct) => (struct.hits < scene.hitsMax) && struct.hits < struct.hitsMax * (1 - scene.parameters.MAXDECAY)
        });
        if(closestDamagedStructure) {
            tower.repair(closestDamagedStructure);
        }
    }
}


module.exports.loop = function () {

    if ((!Memory.accessibility) || (Memory.reset)) {
        Memory.accessibility = {};
    }
    if (Memory.reset) {
        console.log("Resetting!");
        Memory.servers = {};
        _.forEach(Game.creeps, creep => {
            creep.memory.role = "idle";
            creep.memory.target = null;
        });
        Memory.reset = false;
    }

    var scene = planscene();

    if (scene == null) {
        return false;
    }

    if (Game.time % 10 === 0) {
        if (scene.parameters.DEBUG) {
            console.log("Energy: " + scene.totalenergy + "/" + scene.totalcapacity + " , Idlers: " + scene.idlers + ", Harvesters: " + scene.harvesters, ", Carriers: " + scene.carriers + ", Builders: " + scene.builders + ", Repairers: " + scene.repairers + ", Upgraders: " + scene.upgraders);
        }
    }

    //run all the creeps
    scene.creeps.forEach(creep => {
        run(creep, scene);
    });

    scene.towers.forEach(tower => {
        run_tower(tower, scene);
    });

    _.forEach(Game.spawns, spawner => {
        if (spawner.isActive()) { //check if it can be used
            if (!spawner.spawning) { //if we are not already spawning
                var parts = spawnblueprint(scene);
                if (parts.length > 0) {
                    //spawn a creeper
                    var newName = 'Worker' + Game.time;
                    if (spawner.spawnCreep(parts, newName, {memory: {role: 'idle'}}) == OK) {
                        console.log('Spawning new worker');
                    }
                }
            }
        }
    });

    cleanup(scene);
};
