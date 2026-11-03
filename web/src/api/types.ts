export interface Home {
  id: string
  name: string
}

export interface Member {
  id: string
  homeId: string
  name: string
}

export interface Share {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

export interface Bill {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
  createdAt?: string
}

export interface Balance {
  memberId: string
  name: string
  outstandingCents: number
}

export interface ApiError {
  error: string
  status?: number
}
