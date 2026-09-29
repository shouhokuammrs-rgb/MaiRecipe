import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ApiError } from "@/api/client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** API エラーを画面に出す文言にする */
export function apiErrorMessage(e: unknown): string {
  return e instanceof ApiError
    ? e.message
    : "エラーが起きました。もう一度お試しください";
}
