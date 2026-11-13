"use client";

import PropTypes from "prop-types";
import { Icon } from "@/shared/components/icons";

/**
 * The "there is nothing here yet" block.
 *
 * Every page that needed one built its own, and they drifted. The two that
 * carry a title, a description and an action differed in both padding and
 * whether they had an icon at all:
 *
 *   combos        py-12  icon in a primary/10 circle  title mb-1  desc mb-4
 *   proxy-pools   py-10  no icon                      title mb-1  desc mb-4
 *
 * The table empty rows drifted further still — `py-6`, `px-6 py-8` and `p-8`
 * for the same cell — while `.data-table-empty` sat in globals.css used by
 * nothing. Those stay in CSS, since a <tr> cannot take this component; this is
 * for the block form.
 *
 * Deliberately NOT used for the one-line muted notes inside a card or list
 * ("No models added yet", "No connections yet"). Those are a single line of
 * text in a tight space, and wrapping them in a centred block with its own
 * padding would make them louder than the thing they annotate.
 */
export default function EmptyState({ icon, title, description, action, className = "" }) {
  return (
    <div className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      {icon ? (
        <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon name={icon} size={32} />
        </div>
      ) : null}
      <p className="font-medium text-text-main">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

EmptyState.propTypes = {
  /** Optional glyph name from the icon set — see paths.js, not the icon font. */
  icon: PropTypes.string,
  title: PropTypes.node.isRequired,
  description: PropTypes.node,
  /** Usually a <Button>. */
  action: PropTypes.node,
  className: PropTypes.string,
};
