'use client';

import { useRouter } from 'next/navigation';
import SessionProviderWrapper from '@/components/SessionProviderWrapper';
import LandingContent from '@/components/LandingContent';

export default function LandingPage() {
  return (
    <SessionProviderWrapper>
      <LandingContent />
    </SessionProviderWrapper>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="p-6 h-screen bg-gray-800 rounded-lg max-w-xs text-left shadow-md hover:-translate-y-1 transition-transform duration-200"
    >
      <h3 className="text-lg font-bold text-blue-400 mb-2">{title}</h3>
      <p className="text-gray-300">{description}</p>
    </div>
  );
}
