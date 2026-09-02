"use client";

import { ChevronDownIcon, LogOutIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  displayName: string;
  email: string;
};

export function AppHeader({ displayName, email }: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <header className="bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          MaiRecipe
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="max-w-[60vw] gap-1"
              data-testid="user-menu-trigger"
            >
              <UserRoundIcon aria-hidden />
              <span className="truncate" data-testid="header-display-name">
                {displayName}
              </span>
              <ChevronDownIcon aria-hidden className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="truncate text-sm font-medium">{displayName}</div>
              <div className="text-muted-foreground truncate text-xs">{email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/profile">プロフィール設定</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isPending}
              data-testid="logout-menu-item"
              onSelect={() => {
                startTransition(async () => {
                  await signOut();
                });
              }}
            >
              <LogOutIcon aria-hidden />
              ログアウト
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
