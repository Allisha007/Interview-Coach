import { query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const teamRequests = await query(
      "SELECT * FROM TeamRequest ORDER BY created_at DESC"
    );
    return NextResponse.json(teamRequests);
  } catch (error) {
    console.error("Error fetching team requests:", error);
    return NextResponse.json({ error: "Failed to fetch team requests" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, message } = body;

    if (!name || !email || !message) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await query(
      "INSERT INTO TeamRequest (name, email, message, created_at) VALUES ($1, $2, $3, NOW())",
      [name, email, message]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving team request:", error);
    return NextResponse.json({ error: "Failed to save team request" }, { status: 500 });
  }
}