import { User, UserWithStatus, UserStatus } from "./types.js";

export class UserService {
  private users: Map<string, UserWithStatus> = new Map();

  addUser(user: User): UserWithStatus {
    const userWithStatus: UserWithStatus = {
      ...user,
      status: "active",
    };
    this.users.set(user.id, userWithStatus);
    return userWithStatus;
  }

  getUser(id: string): UserWithStatus | undefined {
    return this.users.get(id);
  }

  updateStatus(id: string, status: UserStatus): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    user.status = status;
    return true;
  }

  getAllUsers(): UserWithStatus[] {
    return Array.from(this.users.values());
  }
}

export function createUserService(): UserService {
  return new UserService();
}
