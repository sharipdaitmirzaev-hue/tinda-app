"use client";

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-20 left-1/2 z-40 w-[min(92vw,24rem)] -translate-x-1/2 rounded-md bg-slate-900 px-4 py-3 text-center text-sm text-white shadow-lg md:bottom-6">
      {message}
    </div>
  );
}
