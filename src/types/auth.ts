import { Role, UserStatus } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  isFounder: boolean;
  status: UserStatus;
};
