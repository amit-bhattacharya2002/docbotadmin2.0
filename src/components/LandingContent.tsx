'use client';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LandingContent() {
  const router = useRouter();
  const { data: session, status } = useSession();

  return (
    <div className="min-h-[90vh]  bg-black text-white flex items-center justify-center">
      <div className="w-full max-w-4xl mx-auto py-20 px-4">
        <div className="flex flex-col items-center text-center gap-8">
          <h1 className="text-8xl font-extrabold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">
            Docbot Admin
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
            {status === 'loading' ? (
              <button className="px-8 py-3 rounded-lg border border-blue-500 text-blue-500 font-semibold text-lg opacity-60" disabled>Loading...</button>
            ) : session ? (
              <button
                className="px-8 py-3 rounded-lg border border-blue-500 text-blue-500 font-semibold text-lg hover:bg-blue-500 hover:text-white transition-colors"
                onClick={() => router.push('/dashboard')}
              >
                Go to Dashboard
              </button>
            ) : (
              <button
                className="px-8 py-3 rounded-lg border border-blue-500 text-blue-500 font-semibold text-lg hover:bg-blue-500 hover:text-white transition-colors"
                onClick={() => router.push('/login')}
              >
                Login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 