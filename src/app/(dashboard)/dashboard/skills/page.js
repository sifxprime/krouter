"use client";

import { Card, Badge } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Icon from "../../../../shared/components/icons/Icon";
import {
  SKILLS,
  SKILLS_BLOB_BASE,
  getSkillRawUrl,
  getSkillBlobUrl,
} from "@/shared/constants/skills";

// 0.5.164 — was a hardcoded tree/master; origin has only main and it resolved only
// through GitHub's rename redirect. Derive it so it follows the raw/blob links' branch.
const SKILLS_TREE_URL = SKILLS_BLOB_BASE.replace("/blob/", "/tree/");

function CopyButton({ value, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <button
      onClick={() => copy(value)}
      className="px-2 py-1 rounded-md bg-primary text-white text-[11px] font-medium hover:bg-primary/90 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1"
      title={value}
    >
      <Icon name={copied ? "check" : "content_copy"} size={12} />
      {copied ? "Copied!" : label}
    </button>
  );
}

function SkillRow({ skill }) {
  const url = getSkillRawUrl(skill.id);
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-[14px] border shadow-[var(--shadow-soft)] transition-colors ${
        skill.isEntry
          ? "border-brand-500/40 bg-brand-500/5"
          : "border-border-subtle bg-surface hover:bg-surface-2"
      }`}
    >
      <div
        className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
          skill.isEntry ? "bg-primary text-white" : "bg-primary/10 text-primary"
        }`}
      >
        <Icon name={skill.icon} size={18} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="section-title">{skill.name}</h3>
          {skill.isEntry && (
            <Badge variant="primary" size="sm">START HERE</Badge>
          )}
          {skill.endpoint && (
            <Badge variant="default" size="sm">
              <code className="text-[10px]">{skill.endpoint}</code>
            </Badge>
          )}
        </div>
        <p className="text-xs text-text-muted mt-0.5">{skill.description}</p>
        <a
          href={getSkillBlobUrl(skill.id)}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-text-muted hover:text-primary mt-1 inline-flex items-center gap-1 break-all"
        >
          {url}
          <Icon name="open_in_new" size={12} />
        </a>
      </div>

      <CopyButton value={url} />
    </div>
  );
}

export default function SkillsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card padding="md">
        <div className="text-xs text-text-muted mb-2">Paste this to your AI:</div>
        <div className="px-3 py-2 rounded bg-surface-2 font-mono text-[12px] text-text-main">
          Read this skill and use it: {getSkillRawUrl("krouter")}
        </div>
      </Card>

      <div className="space-y-2">
        {SKILLS.map((skill) => (
          <SkillRow key={skill.id} skill={skill} />
        ))}
      </div>

      <Card padding="md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="section-title">More on GitHub</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Browse source, README, and examples.
            </p>
          </div>
          <a
            href={SKILLS_TREE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <Icon name="open_in_new" size={16} />
            View on GitHub
          </a>
        </div>
      </Card>
    </div>
  );
}
