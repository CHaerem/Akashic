import { useState } from 'react';
import Overview from './Overview';
import Timeline from './Timeline';
import PhotoGallery from './PhotoGallery';
import Stats from './Stats';

export default function InfoPanel({ trekData }) {
    const [activeTab, setActiveTab] = useState('overview');

    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'timeline', label: 'Journey' },
        { id: 'gallery', label: 'Gallery' },
        { id: 'stats', label: 'Stats' }
    ];

    return (
        <div className="h-full flex flex-col bg-[#0a0a0f]">
            {/* Header */}
            <div className="p-6 lg:p-8 border-b border-white/5">
                <p className="text-white/40 text-[10px] tracking-[0.2em] uppercase mb-2 hidden lg:block">
                    {trekData.country}
                </p>
                <h1 className="text-2xl lg:text-3xl font-light text-white tracking-wide hidden lg:block">
                    {trekData.name}
                </h1>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/5 px-6 lg:px-8">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`py-4 px-3 text-[11px] tracking-[0.15em] uppercase transition-all border-b-2 -mb-[2px] ${
                            activeTab === tab.id
                                ? 'border-white/60 text-white'
                                : 'border-transparent text-white/40 hover:text-white/60'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-grow overflow-y-auto p-6 lg:p-8 dark-scrollbar">
                {activeTab === 'overview' && <Overview trekData={trekData} />}
                {activeTab === 'timeline' && <Timeline trekData={trekData} />}
                {activeTab === 'gallery' && <PhotoGallery trekData={trekData} />}
                {activeTab === 'stats' && <Stats trekData={trekData} />}
            </div>
        </div>
    );
}
