# Akashic

**Akashic** is an interactive 3D storytelling platform for visualizing mountain adventures. It combines immersive 3D terrain maps with personal photography and detailed route statistics to create a digital archive of expeditions.

![Akashic Landing Page](public/hero-images/landing-hero.png)

## 🏔️ Features

- **Interactive 3D Maps**: Explore trek routes on a 3D globe using Mapbox GL JS.
- **Visual Storytelling**: Follow the journey camp-by-camp with integrated photo galleries.
- **Detailed Statistics**: Elevation profiles, daily distances, and trek facts.
- **Photo Mapping**: Automatically places photos on the map based on GPS EXIF data.
- **Responsive Design**: Premium experience on desktop, tablet, and mobile.

## 🗺️ Featured Treks

1.  **Kilimanjaro (Lemosho Route)** - Tanzania 🇹🇿
2.  **Mount Kenya (Chogoria/Sirimon)** - Kenya 🇰🇪
3.  **Inca Trail to Machu Picchu** - Peru 🇵🇪

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite
- **Styling**: Tailwind CSS
- **Maps**: Mapbox GL JS
- **Routing**: React Router v6
- **Data Processing**: Node.js, Exif-parser

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+)
- A Mapbox Access Token (Free tier available)

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/CHaerem/Akashic.git
    cd Akashic
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Configure Mapbox**
    - Create a file named `.env` in the root directory.
    - Add your Mapbox token:
      ```
      VITE_MAPBOX_TOKEN=your_mapbox_token_here
      ```

4.  **Add Photos (Optional)**
    - Place your trek photos in `public/images/kilimanjaro`, `public/images/mount-kenya`, etc.
    - Run the photo processing script:
      ```bash
      npm run generate-photos
      ```

5.  **Start Development Server**
    ```bash
    npm run dev
    ```

## 📝 License

This project is personal and created as a gift.
