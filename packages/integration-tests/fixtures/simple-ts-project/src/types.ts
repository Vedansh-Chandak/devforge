export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserStatus = "active" | "inactive" | "pending";

export interface UserWithStatus extends User {
  status: UserStatus;
}
