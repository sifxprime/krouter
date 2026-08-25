"use client";

import PresidioSettingsCard from "./PresidioSettingsCard";

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-main">Settings</h1>
        <p className="text-text-muted mt-1">
          Configure kRouter security and middleware settings
        </p>
      </div>

      {/* Presidio Settings Card */}
      <PresidioSettingsCard />
    </div>
  );
}
