"use client";

const FORK_REPO = "https://github.com/sifxprime/krouter";
const UPSTREAM_REPO = "https://github.com/decolua/9router";
const NPM_PKG = "https://www.npmjs.com/package/@sifxprime/krouter";

export default function Footer() {
  return (
    <footer className="border-t border-[#3a2f27] bg-[#120f0d] pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-16">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <img src="/favicon.svg" alt="kRouter" className="size-7" />
              <h3 className="text-white text-lg font-bold">kRouter</h3>
              <span className="text-gray-500 text-xs">by Kodelyth</span>
            </div>
            <p className="text-gray-500 text-sm max-w-xs mb-6">
              The unified endpoint for AI generation. Connect, route, and manage your AI providers with ease. Hardened fork of 9Router.
            </p>
            <div className="flex gap-4">
              <a className="text-gray-400 hover:text-white transition-colors" href={FORK_REPO} target="_blank" rel="noopener noreferrer">
                <span className="material-symbols-outlined">code</span>
              </a>
            </div>
          </div>

          {/* Product */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Product</h4>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="#features">Features</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="/dashboard">Dashboard</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href={`${FORK_REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">Changelog</a>
          </div>

          {/* Resources */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Resources</h4>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href={`${FORK_REPO}#readme`} target="_blank" rel="noopener noreferrer">Documentation</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href={FORK_REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href={NPM_PKG} target="_blank" rel="noopener noreferrer">NPM</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href={UPSTREAM_REPO} target="_blank" rel="noopener noreferrer">Upstream (decolua/9router)</a>
          </div>

          {/* Legal */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Legal</h4>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href={`${FORK_REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">MIT License</a>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-[#3a2f27] pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-gray-600 text-sm">© 2026 Kodelyth AI Infrastructure. kRouter is a hardened fork of <a className="hover:text-white transition-colors" href={UPSTREAM_REPO} target="_blank" rel="noopener noreferrer">9Router</a> (MIT).</p>
          <div className="flex gap-6">
            <a className="text-gray-600 hover:text-white text-sm transition-colors" href={FORK_REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-gray-600 hover:text-white text-sm transition-colors" href={NPM_PKG} target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
