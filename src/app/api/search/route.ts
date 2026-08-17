import { handleSearchRequest } from "@/modules/gurbani/controllers/gurbani.controller";

export const maxDuration = 30;

export const POST = async (req: Request) => {
    return handleSearchRequest(req);
};
