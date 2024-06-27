import "./MenuGroup.css";
import { ReactNode } from "react";

export const MenuGroup = ({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) => {
  return (
    <div className="menu-group">
      {title}
      {children}
    </div>
  );
};
