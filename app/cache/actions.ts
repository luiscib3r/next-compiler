"use server";

import { revalidateTag, updateTag } from "next/cache";

export async function revalidateQuote() {
  revalidateTag("quote", "max");
}

export async function updateQuote() {
  updateTag("quote");
}
