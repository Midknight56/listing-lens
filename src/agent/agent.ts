export interface Reservation { settle(spent: number): Promise<void> }
export interface Budget { reserve(): Promise<Reservation | null> }
