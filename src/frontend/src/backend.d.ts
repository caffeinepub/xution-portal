import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface SectorLog {
    id: string;
    title: string;
    body: string;
    date: string;
    sector: string;
    level: bigint;
    author: string;
}
export interface MenuItem {
    id: string;
    name: string;
    createdBy: string;
    description: string;
    stock: bigint;
    price: number;
    facility: string;
}
export interface AdminPost {
    id: string;
    content: string;
    date: string;
    minLvl: bigint;
    sector: string;
    author: string;
}
export interface ActivityEntry {
    ts: string;
    msg: string;
}
export interface User {
    uid: string;
    question: string;
    name: string;
    answer: string;
    level: bigint;
}
export interface Transaction {
    id: string;
    ts: string;
    member: string;
    changedBy: string;
    description: string;
    newAmount: number;
    prevAmount: number;
}
export interface backendInterface {
    addActivity(msg: string, ts: string): Promise<void>;
    addAdminPost(author: string, content: string, minLvl: bigint, date: string, sector: string): Promise<string>;
    addMenuItem(facility: string, name: string, price: number, description: string, createdBy: string, stock: bigint): Promise<string>;
    addSectorLog(sector: string, title: string, body: string, author: string, level: bigint, date: string): Promise<string>;
    addTransaction(member: string, prevAmount: number, newAmount: number, changedBy: string, ts: string, description: string): Promise<string>;
    clearBroadcast(): Promise<void>;
    clearOldActivities(): Promise<void>;
    deleteAdminPost(id: string): Promise<void>;
    deleteMenuItem(id: string): Promise<void>;
    deleteSectorLog(id: string): Promise<void>;
    deleteUser(name: string): Promise<void>;
    getActivities(): Promise<Array<ActivityEntry>>;
    getAdminPosts(sector: string): Promise<Array<AdminPost>>;
    getAllAdminPosts(): Promise<Array<AdminPost>>;
    getAllMemberFunds(): Promise<Array<[string, number]>>;
    getAllMenuItems(): Promise<Array<MenuItem>>;
    getAllSectorLogs(): Promise<Array<SectorLog>>;
    getAllTransactions(): Promise<Array<Transaction>>;
    getAllUsers(): Promise<Array<[string, bigint]>>;
    getBroadcast(): Promise<string>;
    getCardNumber(name: string): Promise<string>;
    getContent(key: string): Promise<string>;
    getLockdown(): Promise<boolean>;
    getMemberFunds(name: string): Promise<number>;
    getMemberTransactions(member: string): Promise<Array<Transaction>>;
    getMenuItems(facility: string): Promise<Array<MenuItem>>;
    getOfficeLocations(): Promise<string>;
    getSectorLogs(sector: string): Promise<Array<SectorLog>>;
    getSecurityQuestion(name: string): Promise<string>;
    getUserCount(): Promise<bigint>;
    loginUser(name: string, answer: string): Promise<User>;
    registerUser(name: string, question: string, answer: string): Promise<void>;
    setBroadcast(msg: string): Promise<void>;
    setCardNumber(name: string, cardNum: string): Promise<void>;
    setContent(key: string, value: string): Promise<void>;
    setLockdown(active: boolean): Promise<void>;
    setMemberFunds(name: string, amount: number): Promise<void>;
    setOfficeLocations(json: string): Promise<void>;
    updateAdminPost(id: string, newContent: string): Promise<void>;
    updateMenuItemStock(id: string, newStock: bigint): Promise<void>;
    updateSectorLog(id: string, newBody: string): Promise<void>;
    updateUserLevel(name: string, newLevel: bigint): Promise<void>;
    updateUserAnswer(name: string, newAnswer: string): Promise<void>;
    userExists(name: string): Promise<boolean>;
}
