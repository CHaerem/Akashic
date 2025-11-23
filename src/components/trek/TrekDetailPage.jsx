import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Navbar from '../common/Navbar';
import Map3D from './Map3D';
import InfoPanel from './InfoPanel';
import LoadingSpinner from '../common/LoadingSpinner';
import kilimanjaroData from '../../data/kilimanjaro.json';
import mountKenyaData from '../../data/mountKenya.json';
import incaTrailData from '../../data/incaTrail.json';

const trekDataMap = {
    'kilimanjaro': kilimanjaroData,
    'mount-kenya': mountKenyaData,
    'inca-trail': incaTrailData
};

export default function TrekDetailPage() {
    const { trekId } = useParams();
    const [trekData, setTrekData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        // Simulate async data loading
        setTimeout(() => {
            if (trekId && trekDataMap[trekId]) {
                setTrekData(trekDataMap[trekId]);
            }
            setLoading(false);
        }, 300);
    }, [trekId]);

    if (loading) {
        return (
            <div className="h-screen flex flex-col">
                <Navbar />
                <div className="flex-grow pt-16">
                    <LoadingSpinner fullScreen />
                </div>
            </div>
        );
    }

    if (!trekData) {
        return (
            <div className="min-h-screen bg-mountain-50 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-mountain-900 mb-4">Trek not found</h2>
                    <Link to="/" className="text-mountain-500 hover:underline">Return Home</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Navbar />

            <div className="flex-grow flex flex-col md:flex-row relative pt-16">
                {/* Left/Top: 3D Map */}
                <div className="w-full md:w-3/5 h-[40vh] md:h-full relative">
                    <Map3D routeData={trekData} />

                    {/* Overlay Title for Mobile */}
                    <div className="absolute top-4 left-4 md:hidden z-10">
                        <h1 className="text-2xl font-bold text-white drop-shadow-lg">{trekData.name}</h1>
                    </div>
                </div>

                {/* Right/Bottom: Info Panel */}
                <div className="w-full md:w-2/5 h-[60vh] md:h-full bg-white border-l border-gray-200 shadow-xl z-20 overflow-hidden">
                    <InfoPanel trekData={trekData} />
                </div>
            </div>
        </div>
    );
}
