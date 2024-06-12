import "./MenuGroup.css";
import { ReactNode } from "react";

export const MenuGroup = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => {
  return (
    <div className="menu-group">
      <h2>{title}</h2>
      {children}
    </div>
  );
};
