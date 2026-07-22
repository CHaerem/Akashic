/**
 * Waypoints (days/camps).
 *
 * Reads only on web — creating, editing, repositioning, deleting and reordering days
 * are native-only (D6). The shapes below stay here rather than in the adapter because
 * the adapter imports them.
 */

export interface WaypointUpdate {
    name?: string;
    description?: string;
    elevation?: number | null;
    day_number?: number | null;
    highlights?: string[] | null;
    coordinates?: [number, number];
    route_distance_km?: number | null;
    route_point_index?: number | null;
}

export interface NewWaypoint {
    journey_id: string;
    name: string;
    waypoint_type?: string;
    day_number?: number;
    coordinates: [number, number];
    elevation?: number;
    description?: string;
    sort_order?: number;
    route_distance_km?: number;
    route_point_index?: number;
}

export {
    getWaypoint,
    updateWaypoint,
    updateWaypointPosition,
    createWaypoint,
    deleteWaypoint,
    updateWaypointOrder,
} from './adapters/cloudkit/waypointAdapter';
