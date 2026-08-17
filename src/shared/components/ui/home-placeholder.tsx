import React from 'react';

export const HomePlaceholder = () => (
    <div className="h-full flex items-center justify-center p-6 text-center relative z-10 w-full">
        <div className="animate-in fade-in zoom-in-95 duration-1000 flex items-center justify-center">

            {/* The Ik Onkar perfectly encased inside the lotus */}
            <div className="relative inline-flex items-center justify-center group">
                {/* Vibrant but subtle radial glow centered exactly behind the symbol */}
                <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(212,44,92,0.18)_0%,transparent_60%)] blur-xl rounded-full scale-150 transition-transform duration-3000 ease-in-out group-hover:scale-[1.8]"></div>

                {/* Larger and fluidly responsive Ik Onkar */}
                <p
                    className="text-[35vmin] md:text-[45vmin] text-accent/20 font-bold leading-none select-none relative z-10 drop-shadow-2xl transition-all duration-1000 ease-out group-hover:text-accent/30 group-hover:scale-[1.05]"
                    style={{ textShadow: "0 0 8vmin rgba(212,44,92,0.2)" }}
                >
                    ੴ
                </p>
            </div>
        </div>
    </div>
);
