/**
 * The only logging in this Worker (SY-44). It takes route patterns, status codes,
 * error codes and counts — never request bodies, headers, IP addresses, account,
 * box or member ids, or menu data. The type keeps it that way.
 */

type LogLine = {
  /** A route pattern like "PUT /v1/menus/:id", never a concrete path. */
  route: string;
  status: number;
  code: string;
  /** Optional counts (e.g. from the daily purge). */
  [count: string]: string | number;
};

export const log = (line: LogLine) => {
  console.log(JSON.stringify(line));
};
