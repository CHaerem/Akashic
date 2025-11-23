import { useState } from 'react';
import Overview from './Overview';
import Timeline from './Timeline';
import PhotoGallery from './PhotoGallery';
import Stats from './Stats';

export default function InfoPanel({ trekData }) {
    const [activeTab, setActiveTab] = useState('overview');

    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'timeline', label: 'Timeline' },
        { id: 'gallery', label: 'Gallery' },
        { id: 'stats', label: 'Stats' }
    ];

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="p-6 border-b border-gray-100">
                <h1 className="text-3xl font-bold text-mountain-900 mb-1 hidden md:block">{trekData.name}</h1>
                <p className="text-mountain-500 font-medium">{trekData.country}</p>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 px-6 sticky top-0 bg-white z-10">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`py-4 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id
                                ? 'border-orange-500 text-orange-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-grow overflow-y-auto p-6">
                {activeTab === 'overview' && <Overview trekData={trekData} />}
                {activeTab === 'timeline' && <Timeline trekData={trekData} />}
                {activeTab === 'gallery' && <PhotoGallery trekData={trekData} />}
                {activeTab === 'stats' && <Stats trekData={trekData} />}
            </div>
        </div>
    );
}
