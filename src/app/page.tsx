'use client';

import { useRouter } from 'next/navigation';

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen  bg-black text-white flex items-center justify-center">
      <div className="w-full max-w-4xl mx-auto py-20 px-4">
        <div className="flex flex-col items-center text-center gap-8">
          <h1 className="text-8xl font-extrabold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">
            DocBot Admin
          </h1>
          <p className="text-xl max-w-2xl text-gray-300">
            Streamline your document management and knowledge base with AI-powered insights.
            Create, organize, and manage your company's documents efficiently.
          </p>
          <div className="flex flex-row gap-6 pt-4">
            <button
              className="px-8 py-3 rounded-lg bg-blue-500 text-white font-semibold text-lg hover:bg-blue-600 transition-colors"
              onClick={() => router.push('/register')}
            >
              Create Account
            </button>
            <button
              className="px-8 py-3 rounded-lg border border-blue-500 text-blue-500 font-semibold text-lg hover:bg-blue-500 hover:text-white transition-colors"
              onClick={() => router.push('/login')}
            >
              Login
            </button>
          </div>
          {/* <div className="flex flex-col items-center pt-12 max-w-3xl w-full gap-4">
            <h2 className="text-2xl font-bold text-blue-400">Key Features</h2>
            <div className="flex flex-wrap justify-center gap-8 w-full">
              <FeatureCard
                title="AI-Powered Search"
                description="Find relevant information instantly with advanced semantic search"
              />
              <FeatureCard
                title="Document Management"
                description="Organize and manage your company's documents efficiently"
              />
              <FeatureCard
                title="Secure Access"
                description="Role-based access control for enhanced security"
              />
            </div>
          </div> */}
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="p-6 bg-gray-800 rounded-lg max-w-xs text-left shadow-md hover:-translate-y-1 transition-transform duration-200"
    >
      <h3 className="text-lg font-bold text-blue-400 mb-2">{title}</h3>
      <p className="text-gray-300">{description}</p>
    </div>
  );
}
