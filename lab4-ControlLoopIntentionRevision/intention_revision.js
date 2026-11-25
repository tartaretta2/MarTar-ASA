import 'dotenv/config';
import { DjsConnect, DjsClientSocket } from "@unitn-asa/deliveroo-js-sdk/client";

const socket = DjsConnect();

/** @type { function ({x:number, y:number}, {x:number, y:number}): number } */
function distance( {x:x1, y:y1}, {x:x2, y:y2}) {
    const dx = Math.abs( Math.round(x1) - Math.round(x2) )
    const dy = Math.abs( Math.round(y1) - Math.round(y2) )
    return dx + dy;
}

const MAX_CARRYING = 5;
const INTENTION_TIMEOUT_MS = 5000;

/**
 * Belief revision
 */

/**
 * @type { {id:string, name:string, x:number, y:number, score:number} }
 */
const me = {id: '', name: '', x: -1, y: -1, score: 0};

socket.onSensing( ( { self } ) => {
    if ( ! self ) return;
    const {id, name, x, y, score} = self;
    me.id = id;
    me.name = name;
    if ( x != undefined ) me.x = x;
    if ( y != undefined ) me.y = y;
    me.score = score;
} )

/**
 * @type { Map< string, {id: string, carriedBy?: string, x:number, y:number, reward:number} > }
 */
const parcels = new Map();

const carrying = new Map();
//let myAgent;

/**
 * @type { {x:number, y:number}[] }
 */
const deliveryTiles = [];

socket.onMap( ( width, height, tiles ) => {
    deliveryTiles.length = 0;
    for ( const tile of tiles ) {
        if (tile.type === '2' || tile.type === '9') {
            deliveryTiles.push({ x: tile.x, y: tile.y });
        }
    }
} )

socket.onSensing( async ( sensing ) => {
    // add or update perceived parcels
    for (const p of sensing.parcels) {
        parcels.set( p.id, p);
        
        // check parcels being carried by me
        if ( p.carriedBy == me.id ) 
            carrying.set( p.id, p );
        else  
            carrying.delete( p.id );
    }

    // forget parcels that are no longer perceived
    const perceived_ids = new Set( sensing.parcels.map( p => p.id ) );
    for ( const id of parcels.keys() ) {
        if ( ! perceived_ids.has( id ) ) {
            parcels.delete( id );
        }
    }

    for ( const id of carrying.keys() ) {
        if ( ! perceived_ids.has( id ) )
            carrying.delete( id );
    }

    if ( carrying.size === 0 )
        myAgent?.cancelCurrent( 'go_deliver' );
} )

const occupied = new Set();

function nearestDelivery ( position ) {
    return deliveryTiles
        .slice()
        .sort( (a, b) => distance( position, a ) - distance( position, b ) )[0];
}


socket.onSensing( async ( sensing ) => {
    occupied.clear();
    for( const a of sensing.agents ){
        if ( a.id == me.id ) continue;
        if ( a.x == undefined || a.y == undefined ) continue;
        occupied.add( key(Math.floor(a.x), Math.floor(a.y)) );
        occupied.add( key(Math.ceil(a.x), Math.ceil(a.y)) );
    }
})

// the map

// key for the .set() function of Map
function key(x,y){
    return `${x},${y}`;
}

const spawnerTiles = [];    //parcels spawner
const walkableTiles = [];   
const tileTypes = new Map;

socket.onMap( (width, height, tiles) => {
    spawnerTiles.length = 0;
    walkableTiles.length = 0; 
    tileTypes.clear();

    for( const tile of tiles ) {
        tileTypes.set(key(tile.x, tile.y), tile.type);

        if( tile.type == '0' ){
            continue;
        }
        walkableTiles.push( {x: tile.x, y: tile.y});
        
        if ( tile.type == '1' ){
            spawnerTiles.push( {x: tile.x, y: tile.y} );
        }
    }
} )

function pickExploreTarget(){
    const sx = Math.round(me.x);
    const sy = Math.round(me.y);
    let candidates = [];
    if( spawnerTiles.length > 0 ){
        candidates = spawnerTiles;
    } else { candidates = walkableTiles; }

    let reachable = [];
    for( const t of candidates ){
        const path = bfs(sx, sy, t.x, t.y);
        if (path != null){
            reachable.push({x: t.x, y: t.y, len: path.length});
        }
    }
    
    const far = reachable.filter( tile => tile.len > 3);

    let pool =[];
    if (far.length > 0){
        pool = far;
    } else { pool = reachable; }

    let index = Math.floor( Math.random() * pool.length );
    return pool[index];
} 


// canEnter returns true if the agent can move from the tile "from" to the near "to" tile, otherwise false
const arrowDirections = {
        '↑' : { dx:  0, dy:  1 },
        '→' : { dx:  1, dy:  0 },
        '↓' : { dx:  0, dy: -1 },
        '←' : { dx: -1, dy:  0 }
};

function canEnter(fromX, fromY, toX, toY, avoidAgents=false){
    const type = tileTypes.get(key(toX, toY));

    if( !type ) return false;
    if ( type == '0' ) return false; // '0' = wall

    const dx = toX - fromX;
    const dy = toY - fromY;

    if (type in arrowDirections){
        const v = arrowDirections[type];
        if( dx == -v.dx && dy == -v.dy){
            return false;
        }
    }

    if(avoidAgents && occupied.has( key(toX, toY) )) return false;

    return true

}


// bfs (breadth-first search) function returns the array of moves to go to the target
// example: ['up', 'up', 'left'] or null if the target cannot be reached
// bfs explores "in circles" from the starting point

const moves = [
    { name : 'up', dx : 0, dy : 1 },
    { name: 'down',  dx:  0, dy: -1 },
    { name: 'right', dx:  1, dy:  0 },
    { name: 'left',  dx: -1, dy:  0 }
]

function bfs(startX, startY, targetX, targetY, avoidAgents=false){
    if ( startX == targetX && startY == targetY ) return []; //if you are already in the target
    
    const queue = [ { x : startX, y : startY } ];
    const visited = new Map();
    visited.set( key(startX, startY), null );

    while ( queue.length > 0 ){
        const cur = queue.shift();

        for( const m of moves ){
            const nx = cur.x + m.dx;
            const ny = cur.y + m.dy;

            if (visited.has(key(nx, ny))) continue;
            if ( !canEnter(cur.x, cur.y, nx, ny, avoidAgents) ) continue;


            visited.set( key(nx, ny), { from: cur, move: m.name });

            if(nx == targetX && ny == targetY ){
                const path = [];
                let pos = { x:targetX, y:targetY };
                while(visited.get(key(pos.x, pos.y)) != null){
                    const step = visited.get(key(pos.x, pos.y));
                    path.unshift(step.move);
                    pos = step.from;
                }
                return path;
            }
            queue.push({x: nx, y: ny});
        }
    }
    return null;
}

/**
 * Options generation and filtering function
 */
function optionsGeneration () {

    // TODO revisit beliefset revision so to trigger option generation only in the case a new parcel is observed

    /**
     * Options generation
     * @type { Array< [string, ...any] > }
     */
    const options = []

    //const carrying = Array.from( parcels.values() )
    //    .some( parcel => parcel.carriedBy == me.id );
    if ( carrying.size > 0){
        if( parcels.size == carrying.size || carrying.size == MAX_CARRYING ){
            myAgent.push( [ 'go_deliver' ] );
            return;
        }
        options.push( [ 'go_deliver' ] );
    }

    for (const parcel of parcels.values())
        if ( ! parcel.carriedBy )
            options.push( [ 'go_pick_up', parcel.x, parcel.y, parcel.id ] );
            // myAgent.push( [ 'go_pick_up', parcel.x, parcel.y, parcel.id ] )

    /**
     * Options filtering
     */
    let best_option;
    let nearest = Number.MAX_VALUE;
    for (const option of options) {
        if ( option[0] == 'go_pick_up' ) {
            let [go_pick_up,x,y,id] = option;
            let current_d = distance( {x, y}, me )
            if ( current_d < nearest ) {
                best_option = option;
                nearest = current_d;
            }
        }
    }

    /**
     * Best option is selected
     */
    if ( best_option ){
        myAgent.push( best_option )
    }
    else{
        myAgent.push( ['explore'] )
    }
}

/**
 * Generate options at every sensing event
 */
socket.onSensing( optionsGeneration )
setInterval( optionsGeneration, 500 );

// /**
//  * Alternatively, generate options continuously
//  */
// while (true) {
//     if ( ! me.id || ! parcels.size ) {
//         await new Promise( res => setTimeout( res, 100 ) );
//         continue;
//     }
//     optionsGeneration();
//     await new Promise( res => setTimeout( res ) );
// }



/**
 * Intention revision loop
 */
class IntentionRevision {

    /** @type {IntentionDeliberation[]} */
    #intention_queue = new Array();
    get intention_queue () {
        return this.#intention_queue;
    }

    cancelCurrent ( predicate ) {
        const current = this.intention_queue[0];
        if ( current?.predicate[0] === predicate ) {
            console.log( 'Canceling invalid intention', current.predicate );
            current.stop();
        }
    }

    async loop ( ) {
        while ( true ) {
            // Consumes intention_queue if not empty
            if ( this.intention_queue.length > 0 ) {
                console.log( 'intentionRevision.loop', this.intention_queue.map(i=>i.predicate) );
            
                // Current intention
                const intention = this.intention_queue[0];
                
                // Is queued intention still valid? Do I still want to achieve it?
                // TODO this hard-coded implementation is an example
                let id = intention.predicate[3]
                let p = parcels.get(id)
                if ( intention.predicate[0] == 'go_pick_up' && p && p.carriedBy ) {
                    console.log( 'Skipping intention because no more valid', intention.predicate )
                }
                else if (intention.predicate[0] == 'go_deliver' && carrying.size === 0) {
                    console.log( 'Skipping intention because no more valid', intention.predicate )
                }
                else {
                    let timedOut = false;
                    let timeoutId;
                    const timeout = new Promise( resolve => {
                        timeoutId = setTimeout( () => {
                            timedOut = true;
                            intention.stop();
                            resolve( false );
                        }, INTENTION_TIMEOUT_MS );
                    } );

                    await Promise.race([
                        intention.achieve().catch( error => {
                            console.log( 'Failed intention', ...intention.predicate, 'with error:', error );
                            return false;
                        } ),
                        timeout
                    ]);
                    clearTimeout( timeoutId );
                    if ( timedOut )
                        console.warn( 'Intention timed out and was stopped', intention.predicate );
                }

                // Remove from the queue
                this.intention_queue.shift();
            }
            if ( this.intention_queue.length > 0 )
                await new Promise( res => setImmediate( res ) );
            else
                await new Promise( res => setTimeout( res, 50 ) );
        }
    }

    // async push ( predicate ) { }

    /** @type { function(...any): void } */
    log ( ...args ) {
        console.log( ...args )
    }

    /**
     * @abstract
     * @param { [string, ...any] } predicate is in the form ['go_to', x, y]
     */
    async push ( predicate ) {
    }

}

/**
 * @extends { IntentionRevision }
 */
class IntentionRevisionQueue extends IntentionRevision {

    /**
     * @param { [string, ...any] } predicate is in the form ['go_to', x, y]
     */
    async push ( predicate ) {
        
        // Check if already queued
        if ( this.intention_queue.find( (i) => i.predicate.join(' ') == predicate.join(' ') ) )
            return; // intention is already queued

        console.log( 'IntentionRevisionQueue.push', predicate );
        const intention = new IntentionDeliberation( this, predicate );
        this.intention_queue.push( intention );
    }

}

class IntentionRevisionReplace extends IntentionRevision {

    /**
     * @param { [string, ...any] } predicate is in the form ['go_to', x, y]
     */
    async push ( predicate ) {

        // Check if already queued
        const last = this.intention_queue[this.intention_queue.length - 1];        
        if ( last && last.predicate.join(' ') == predicate.join(' ') ) {
            return; // intention is already being achieved
        }
        
        console.log( 'IntentionRevisionReplace.push', predicate );
        const intention = new IntentionDeliberation( this, predicate );
        this.intention_queue.push( intention );
        
        // Force current intention stop 
        if ( last ) {
            last.stop();
        }
    }

}

/*function utility(predicate){ //predicate = ['go_pick_up', x, y, id]

    if ( predicate[0] === 'go_deliver' ) {
        return deliverUtility();
    }

    if(predicate[0] === 'go_pick_up'){
        const parcel = parcels.get(predicate[3]);
        if(!parcel || parcel.carriedBy){
            return -Infinity;
        }
        return pickupUtility(parcel);
    }

    /*
    let id = predicate[3]
    let p = parcels.get(id)

    if ( p==undefined || p.carriedBy ) {
        return -Infinity;
    }
    else{
        return p.reward - distance(me, p) - distance(p, nearestDelivery(p));
    }
    
}

function carriedReward() {
    let total = 0;

    for (const parcel of carrying.values()) {
        total += parcel.reward;
    }

    return total;
}

function deliverUtility() {
    if (carrying.size === 0) {
        return -Infinity;
    }

    const delivery = nearestDelivery(me);

    if (!delivery) {
        return -Infinity;
    }

    //total reward of carried parcels minus the distance to the nearest delivery tile
    //each parcel loses 1 reward point for each tile of distance to the delivery tile
    return carriedReward() - (carrying.size * distance(me, delivery));
}

function pickupUtility(parcel) {
    const delivery = nearestDelivery(parcel);

    if (!delivery) {
        return -Infinity;
    }

    const routeDistance =
        distance(me, parcel) +
        distance(parcel, delivery);

    return parcel.reward - routeDistance;
}


function totalPossibleReward(){
    let reward = 0;
    //check all possible paths to collect all sensed parcels
    //compare the total reward of each path and return the maximum one
    //also compare with single pickup and delivery paths

    //!!!EXPENSIVE OPERATION???


    for (const p1 of parcels.values()) {
        if (!p1.carriedBy) {
            reward += p1.reward - distance(me, p1) - distance(p1, nearestDelivery(p1));
        }
        if(parcels.size > 1){
            for(const p2 of parcels.values()){
                if(p1.id !== p2.id && !p2.carriedBy){
                    const routeDistance = distance(me, p1) + distance(p1, p2) + distance(p2, nearestDelivery(p2));
                    const totalReward = p1.reward + p2.reward - routeDistance;
                    if(totalReward > reward){
                        reward = totalReward;
                    }
                }
            }   
        }
    }



    return reward;
}*/

function utility(predicate) {
    if ( predicate[0] === 'go_deliver' ) {
        if ( carrying.size === 0 ) return -Infinity;
        const delivery = nearestDelivery( me );
        if ( ! delivery ) return -Infinity;
        let reward = 0;
        for ( const parcel of carrying.values() )
            reward += parcel.reward;
        return reward - carrying.size * distance( me, delivery );
    }

    if ( predicate[0] === 'go_pick_up' ) {
        const parcel = parcels.get( predicate[3] );
        if ( ! parcel || parcel.carriedBy ) return -Infinity;
        const delivery = nearestDelivery( parcel );
        if ( ! delivery ) return -Infinity;
        return parcel.reward - distance( me, parcel ) - distance( parcel, delivery );
    }

    return -Infinity;
}

class IntentionRevisionRevise extends IntentionRevision {

    /**
     * @param { [string, ...any] } predicate is in the form ['go_to', x, y]
     */
    async push ( predicate ) {
        console.log( 'Revising intention queue. Received', ...predicate );
        
        let current = this.intention_queue[0];

        // if the queue is empty, add the new one
        if(current == undefined){
            const intention = new IntentionDeliberation( this, predicate );
            this.intention_queue.push( intention );
            return;
        }
        
        // if the new one is alewady in the queue, return
        if ( this.intention_queue.find( (i) => i.predicate.join(' ') == predicate.join(' ') ) ){
            return;
        }

        const newUtility = utility(predicate);
        const currentUtility = utility(current.predicate);

        // if current = -Infinity OR the new one is much better -> add the new one and stop the current
        if(currentUtility == -Infinity || newUtility > currentUtility + 0.2 * Math.abs(currentUtility)){ //if it is better than 20%
            const intention = new IntentionDeliberation( this, predicate );
            this.intention_queue.push( intention );
    
            current.stop();
        }

        
    }

}

/**
 * Start intention revision loop
 */

// const myAgent = new IntentionRevisionQueue();
//const myAgent = new IntentionRevisionReplace();
const myAgent = new IntentionRevisionRevise();
myAgent.loop();



/**
 * IntentionDeliberation
 */
class IntentionDeliberation {

    // Plan currently used for achieving the desire 
    /** @type { Plan | undefined } */
    #current_plan;
    
    // This is used to stop the intentionDeliberation
    #stopped = false;
    get stopped () {
        return this.#stopped;
    }
    stop () {
        // this.log( 'stop intentionDeliberation', ...this.#predicate );
        this.#stopped = true;
        if ( this.#current_plan)
            this.#current_plan.stop();
    }

    /**
     * #parent refers to caller
     */
    #parent;

    /**
     * Desire to be achieved, for example ['go_to', x, y]
     * @type { [string, ...any] } predicate is in the form ['go_to', x, y]
     */
    #predicate;
    get predicate () {
        return this.#predicate;
    }

    /**
     * @param { IntentionRevision | PlanBase } parent 
     * @param { [string, ...any] } predicate 
     */
    constructor ( parent, predicate ) {
        this.#parent = parent;
        this.#predicate = predicate;
    }

    /** @type { function(...any): void } */
    log ( ...args ) {
        if ( this.#parent && this.#parent.log )
            this.#parent.log( '\t', ...args )
        else
            console.log( ...args )
    }

    #started = false;
    /**
     * Using the plan library to achieve an intention
     * @returns { Promise<boolean> } the result of the plan execution
     */
    async achieve () {
        // Cannot start twice
        if ( this.#started)
            return false;
        else
            this.#started = true;

        // Trying all plans in the library
        for (const planClass of planLibrary) {

            // if stopped then quit
            if ( this.stopped ) throw [ 'stopped intention', ...this.predicate ];

            // if plan is 'statically' applicable
            if ( planClass.isApplicableTo( ...this.predicate ) ) {
                // plan is instantiated
                this.#current_plan = new planClass(this.#parent);
                this.log('achieving intention', ...this.predicate, 'with plan', planClass.name);
                // and plan is executed and result returned
                try {
                    const plan_res = await this.#current_plan?.execute( ...this.predicate );
                    this.log( 'successful intention', ...this.predicate, 'with plan', planClass.name, 'with result:', plan_res );
                    return plan_res || false;
                // or errors are caught so to continue with next plan
                } catch (error) {
                    this.log( 'failed intention', ...this.predicate,'with plan', planClass.name, 'with error:', error );
                }
            }

        }

        // if stopped then quit
        if ( this.stopped ) throw [ 'stopped intention', ...this.predicate ];

        // no plans have been found to satisfy the intention
        // this.log( 'no plan satisfied the intention ', ...this.predicate );
        throw ['no plan satisfied the intention ', ...this.predicate ]
    }

}

/**
 * @typedef { {
 *      stop: ()=>void,
 *      stopped: boolean,
 *      log: (...arg0: any[])=>void,
 *      subIntention: (predicate: any) => Promise<any>,
 *      execute: function (string, ...any) : Promise<boolean>
 * } } Plan
 */

/**
 * @typedef { {
 *      name: string,
 *      isApplicableTo: function (string, ...any) : boolean,
 *      prototype: Plan
 * } } PlanClass
 */

/**
 * Plan library
 * @type { PlanClass [] }
 */
const planLibrary = [];

/**
 * @abstract
 */
class PlanBase {

    // This is used to stop the plan
    #stopped = false;
    stop () {
        // this.log( 'stop plan' );
        this.#stopped = true;
        for ( const i of this.#sub_intentions ) {
            i.stop();
        }
    }
    get stopped () {
        return this.#stopped;
    }

    /**
     * #parent refers to caller
     */
    #parent;

    /**
     * @param { IntentionDeliberation } parent
     */
    constructor ( parent ) {
        this.#parent = parent;
    }

    /** @type { function(...any): void } */
    log ( ...args ) {
        if ( this.#parent && this.#parent.log )
            this.#parent.log( '\t', ...args )
        else
            console.log( ...args )
    }

    // this is an array of sub intention. Multiple ones could eventually being achieved in parallel.
    /** @type { IntentionDeliberation [] } */
    #sub_intentions = [];

    /**
     * @param { [string, ...any] } predicate 
     * @returns { Promise<boolean> }
     */
    async subIntention ( predicate ) {
        const sub_intention = new IntentionDeliberation( this, predicate );
        this.#sub_intentions.push( sub_intention );
        return sub_intention.achieve();
    }

}

/**
 * @implements { Plan }
 */
class GoPickUp extends PlanBase {

    /**
     * @type { function( string, ...any ) : boolean } 
     */
    static isApplicableTo ( go_pick_up, x, y, id ) {
        return go_pick_up == 'go_pick_up';
    }

    /**
     * @type { function( string, ...any ) : Promise<boolean> } 
     */
    async execute ( go_pick_up, x, y ) {
        if ( this.stopped ) throw ['stopped']; // if stopped then quit
        await this.subIntention( ['go_to', x, y] );
        if ( this.stopped ) throw ['stopped']; // if stopped then quit
        const picked = await socket.emitPickup()
        if ( this.stopped ) throw ['stopped']; // if stopped then quit
        
        // update parcels beliefset and carrying set
        for (const p of picked) {
            const parcel = parcels.get(p.id);
            if (parcel) {
                parcel.carriedBy = me.id;
                carrying.set(parcel.id, parcel);
            }
        }

        return true;
    }

}

class Explore extends PlanBase {
    static isApplicableTo(explore){
        if (explore == 'explore'){
            return true;
        } return false;
    }

    async execute(explore){
        let target = pickExploreTarget();
        if ( !target ) throw ['no tile to explore']; //if target doesn't exist
        if ( this.stopped ) throw ['stopped'];
        await this.subIntention(['go_to', target.x, target.y]);
        if ( this.stopped ) throw ['stopped'];  

        return true;
    }
}


class GoToBFS extends PlanBase{
    static isApplicableTo(go_to, x, y){
        return go_to == 'go_to' 
    }

    async execute(go_to, x, y){
        let replans = 0; //how many times recalculated

        while (true){
            if ( this.stopped ) throw ['stopped'];
            const sx = Math.round(me.x);
            const sy = Math.round(me.y);

            if( sx == x && sy == y ) return true;

            const path = bfs(sx, sy, x, y, true); 

            if ( path == null ) throw ['no path'];

            for (const move of path ){
                if ( this.stopped ) throw ['stopped'];

                const result = await socket.emitMove(move);

                if ( result ) {
                    me.x = result.x;
                    me.y = result.y;
                } else {
                    replans++;
                    if ( replans > 3 ) throw ['stuck'];
                    break;
                }
            }   
        }
    }
}

/**
 * @implements { Plan }
 * @extends { PlanBase }
 */
class GoDeliver extends PlanBase {

    /**
     * @type { function( string ) : boolean }
     */
    static isApplicableTo ( go_deliver ) {
        return go_deliver == 'go_deliver';
    }

    /**
     * @type { function( string ) : Promise<boolean> }
     */
    async execute ( go_deliver ) {
        if ( this.stopped || carrying.size === 0 )
            throw [ 'no parcels to deliver' ];

        const delivery = nearestDelivery( me );
        if ( ! delivery )
            throw [ 'no delivery tile available' ];

        await this.subIntention( [ 'go_to', delivery.x, delivery.y ] );
        if ( this.stopped || carrying.size === 0 ) throw [ 'stopped' ];

        const dropped = await socket.emitPutdown();

        // update parcels beliefset and carrying set
        for (const p of dropped) {
            const parcel = parcels.get(p.id);
            if (parcel) {
                parcel.carriedBy = undefined;
                carrying.delete(parcel.id);
            }
        }   
        return true;
    }
}

/**
 * @implements { Plan }
 * @extends { PlanBase }
 */
class BlindMove extends PlanBase {

    /**
     * @type { function( string, ...any ) : boolean } 
     */
    static isApplicableTo ( go_to, x, y ) {
        return go_to == 'go_to';
    }

    /**
     * @type { function( string, ...any ) : Promise<boolean> } 
     */
    async execute ( go_to, x, y ) {

        while ( me.x != x || me.y != y ) {

            if ( this.stopped ) throw ['stopped']; // if stopped then quit

            let moved_horizontally;
            let moved_vertically;
            
            // this.log('me', me, 'xy', x, y);

            if ( x > me.x )
                moved_horizontally = await socket.emitMove('right')
                // status_x = await this.subIntention( 'go_to', {x: me.x+1, y: me.y} );
            else if ( x < me.x )
                moved_horizontally = await socket.emitMove('left')
                // status_x = await this.subIntention( 'go_to', {x: me.x-1, y: me.y} );

            if (moved_horizontally) {
                me.x = moved_horizontally.x;
                me.y = moved_horizontally.y;
            }

            if ( this.stopped ) throw ['stopped']; // if stopped then quit

            if ( y > me.y )
                moved_vertically = await socket.emitMove('up')
                // status_x = await this.subIntention( 'go_to', {x: me.x, y: me.y+1} );
            else if ( y < me.y )
                moved_vertically = await socket.emitMove('down')
                // status_x = await this.subIntention( 'go_to', {x: me.x, y: me.y-1} );

            if (moved_vertically) {
                me.x = moved_vertically.x;
                me.y = moved_vertically.y;
            }
            
            if ( ! moved_horizontally && ! moved_vertically) {
                this.log('stuck');
                throw 'stuck';
            } else if ( me.x == x && me.y == y ) {
                // this.log('target reached');
            }
            
        }

        return true;

    }
}

// plan classes are added to plan library 
planLibrary.push( GoPickUp )
planLibrary.push( Explore )
planLibrary.push( GoToBFS )
planLibrary.push( GoDeliver )
planLibrary.push( BlindMove )
