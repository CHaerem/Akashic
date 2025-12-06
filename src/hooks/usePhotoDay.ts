/**
 * Hook for matching photos to journey days
 *
 * Uses a 4-tier matching strategy:
 * 1. Explicit waypoint_id assignment
 * 2. Date matching (photo taken_at vs journey start date)
 * 3. Location-based route segment estimation
 * 4. Nearest camp fallback
 */

import { useMemo, useCallback } from 'react';
import type { TrekData, Photo, Camp } from '../types/trek';
import { getDistanceFromLatLonInKm, findNearestCoordIndex } from '../utils/geography';

interface UsePhotoDayResult {
  /** Map from waypoint ID to day number */
  waypointToDayMap: Map<string, number>;
  /** Get the day number for a photo (or null if can't determine) */
  getPhotoDay: (photo: Photo) => number | null;
  /** Get all photos for a specific day */
  getPhotosForDay: (dayNumber: number) => Photo[];
  /** Photos grouped by day number (including 'unassigned' key) */
  photosByDay: Record<number | 'unassigned', Photo[]>;
}

export function usePhotoDay(trekData: TrekData, photos: Photo[]): UsePhotoDayResult {
  // Build a map from waypoint ID to day number
  const waypointToDayMap = useMemo(() => {
    const map = new Map<string, number>();
    trekData.camps.forEach((camp: Camp) => {
      map.set(camp.id, camp.dayNumber);
    });
    return map;
  }, [trekData.camps]);

  // Get the day number for a photo using 4-tier matching
  const getPhotoDay = useCallback((photo: Photo): number | null => {
    // 1. Check explicit waypoint_id assignment
    if (photo.waypoint_id) {
      const day = waypointToDayMap.get(photo.waypoint_id);
      if (day !== undefined) return day;
    }

    // 2. Date matching if journey has a start date
    if (photo.taken_at && trekData.dateStarted) {
      const photoDate = new Date(photo.taken_at);
      const startDate = new Date(trekData.dateStarted);
      const diffTime = photoDate.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      const dayNum = diffDays + 1; // Day 1 is day 0 diff

      if (dayNum >= 1 && dayNum <= trekData.camps.length) {
        return dayNum;
      }
    }

    // 3. Location-based estimation using route segments
    if (photo.coordinates && trekData.route?.coordinates && trekData.camps.length > 0) {
      const routeCoords = trekData.route.coordinates;
      const [photoLng, photoLat] = photo.coordinates;

      // Find nearest point on the route
      const nearestRouteIdx = findNearestCoordIndex(routeCoords, [photoLng, photoLat]);
      const nearestPoint = routeCoords[nearestRouteIdx];
      const distToRoute = getDistanceFromLatLonInKm(photoLat, photoLng, nearestPoint[1], nearestPoint[0]);

      // Only use if photo is within 2km of route
      if (distToRoute < 2) {
        const sortedCamps = [...trekData.camps]
          .filter(c => c.routePointIndex != null)
          .sort((a, b) => (a.routePointIndex || 0) - (b.routePointIndex || 0));

        // Find which day segment contains this route index
        for (const camp of sortedCamps) {
          if (nearestRouteIdx <= (camp.routePointIndex || 0)) {
            return camp.dayNumber;
          }
        }

        // If past all camps, assign to last day
        if (sortedCamps.length > 0) {
          return sortedCamps[sortedCamps.length - 1].dayNumber;
        }
      }
    }

    // 4. Nearest camp fallback (within 5km)
    if (photo.coordinates && trekData.camps.length > 0) {
      const [photoLng, photoLat] = photo.coordinates;
      let nearestDay: number | null = null;
      let minDistance = Infinity;

      for (const camp of trekData.camps) {
        const [campLng, campLat] = camp.coordinates;
        const distance = getDistanceFromLatLonInKm(photoLat, photoLng, campLat, campLng);
        if (distance < minDistance) {
          minDistance = distance;
          nearestDay = camp.dayNumber;
        }
      }

      if (nearestDay !== null && minDistance < 5) {
        return nearestDay;
      }
    }

    return null;
  }, [waypointToDayMap, trekData.dateStarted, trekData.camps, trekData.route?.coordinates]);

  // Get photos for a specific day
  const getPhotosForDay = useCallback((dayNumber: number): Photo[] => {
    return photos.filter(p => getPhotoDay(p) === dayNumber);
  }, [photos, getPhotoDay]);

  // Group all photos by day
  const photosByDay = useMemo(() => {
    const groups: Record<number | 'unassigned', Photo[]> = { unassigned: [] };

    trekData.camps.forEach((camp: Camp) => {
      groups[camp.dayNumber] = [];
    });

    photos.forEach(photo => {
      const day = getPhotoDay(photo);
      if (day !== null && groups[day]) {
        groups[day].push(photo);
      } else {
        groups.unassigned.push(photo);
      }
    });

    return groups;
  }, [photos, getPhotoDay, trekData.camps]);

  return {
    waypointToDayMap,
    getPhotoDay,
    getPhotosForDay,
    photosByDay,
  };
}
