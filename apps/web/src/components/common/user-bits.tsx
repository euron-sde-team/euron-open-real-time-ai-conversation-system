"use client";

import Link from "next/link";
import { Avatar, type AvatarSize } from "@open-conversation/ui";
import type { UserSummary } from "@open-conversation/types";

type AvatarUser = Pick<UserSummary, "id" | "displayName" | "username">;

export function UserAvatar({ user, size = "md", className, href }: { user: AvatarUser; size?: AvatarSize; className?: string; href?: string }) {
  const av = <Avatar name={user.displayName} seed={user.id} size={size} className={className} />;
  if (!href) return av;
  return (
    <Link href={href} className="shrink-0 rounded-full focus-visible:ring-2" tabIndex={-1} aria-hidden>
      {av}
    </Link>
  );
}

