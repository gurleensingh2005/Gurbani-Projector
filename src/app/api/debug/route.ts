import { NextResponse } from "next/server";
import * as baniDB from "@sttm/banidb";

export const GET = async (): Promise<NextResponse> => {
  return NextResponse.json(baniDB);
};
