"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type GreetState = { message: string; count: number };

export async function greet(
  previous: GreetState,
  formData: FormData,
): Promise<GreetState> {
  const name = String(formData.get("name") ?? "").trim() || "anónimo";
  const count = previous.count + 1;
  (await cookies()).set("ultimo-saludo", name);
  return { message: `Hola, ${name} (desde el servidor)`, count };
}

export async function goToStatic() {
  redirect("/static");
}
