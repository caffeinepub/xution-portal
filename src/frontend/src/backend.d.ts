import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface User {
    uid: string;
    question: string;
    name: string;
    answer: string;
    level: bigint;
}
export interface backendInterface {
    deleteUser(name: string): Promise<void>;
    getAllUsers(): Promise<Array<[string, bigint]>>;
    getSecurityQuestion(name: string): Promise<string>;
    getUserCount(): Promise<bigint>;
    loginUser(name: string, answer: string): Promise<User>;
    registerUser(name: string, question: string, answer: string): Promise<void>;
    updateUserLevel(name: string, newLevel: bigint): Promise<void>;
    userExists(name: string): Promise<boolean>;
}
