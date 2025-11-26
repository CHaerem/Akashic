-- Journeys: A trek/trip/vacation created by a user
CREATE TABLE journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  country TEXT,
  journey_type TEXT DEFAULT 'trek',

  -- Trek-specific (optional)
  summit_elevation INTEGER,
  total_distance NUMERIC,
  total_days INTEGER,
  date_started DATE,
  date_ended DATE,

  -- Media
  hero_image_url TEXT,
  gpx_url TEXT,

  -- Map settings
  center_coordinates JSONB,
  default_zoom NUMERIC,

  -- Metadata
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Waypoints: Stops/locations along a journey
CREATE TABLE waypoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,
  waypoint_type TEXT DEFAULT 'camp',
  day_number INTEGER,

  -- Location
  coordinates JSONB NOT NULL,
  elevation INTEGER,

  -- Content
  description TEXT,
  highlights TEXT[],

  -- Timing (optional)
  arrival_time TEXT,
  departure_time TEXT,
  date_visited DATE,

  -- Order
  sort_order INTEGER,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Photos: Images associated with journeys/waypoints
CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,
  waypoint_id UUID REFERENCES waypoints(id) ON DELETE SET NULL,

  -- Storage
  url TEXT NOT NULL,
  thumbnail_url TEXT,

  -- Metadata
  caption TEXT,
  coordinates JSONB,
  taken_at TIMESTAMPTZ,

  -- Display
  is_hero BOOLEAN DEFAULT false,
  sort_order INTEGER,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security (RLS) policies
ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

-- Users can read public journeys or their own
CREATE POLICY "Public journeys readable by all" ON journeys
  FOR SELECT USING (is_public = true OR auth.uid() = user_id);

-- Users can only modify their own journeys
CREATE POLICY "Users can manage own journeys" ON journeys
  FOR ALL USING (auth.uid() = user_id);

-- Waypoints inherit journey permissions
CREATE POLICY "Waypoints follow journey permissions" ON waypoints
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = waypoints.journey_id
      AND (journeys.is_public = true OR journeys.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage own waypoints" ON waypoints
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = waypoints.journey_id
      AND journeys.user_id = auth.uid()
    )
  );

-- Photos inherit journey permissions
CREATE POLICY "Photos follow journey permissions" ON photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = photos.journey_id
      AND (journeys.is_public = true OR journeys.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage own photos" ON photos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = photos.journey_id
      AND journeys.user_id = auth.uid()
    )
  );

-- Indexes for performance
CREATE INDEX idx_journeys_user_id ON journeys(user_id);
CREATE INDEX idx_journeys_slug ON journeys(slug);
CREATE INDEX idx_waypoints_journey_id ON waypoints(journey_id);
CREATE INDEX idx_photos_journey_id ON photos(journey_id);
CREATE INDEX idx_photos_waypoint_id ON photos(waypoint_id);
