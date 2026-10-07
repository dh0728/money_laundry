package com.moneylaundry.api.auth;

import java.security.Principal;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.*;
import org.springframework.stereotype.Service;

@Service
public class StaffAccounts implements UserDetailsService {
  private final JdbcTemplate jdbc;

  public StaffAccounts(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Map<String, Object> account(String username) {
    var rows =
        jdbc.queryForList(
            "select user_id as id,username,name,role,password_hash from core.users where username=? and role in ('STAFF','ADMIN')",
            username);
    if (rows.isEmpty()) throw new UsernameNotFoundException("Invalid credentials");
    return rows.getFirst();
  }

  @Override
  public UserDetails loadUserByUsername(String username) {
    var row = account(username);
    String hash = (String) row.get("password_hash");
    return User.withUsername(username)
        .password(hash == null ? "" : hash)
        .roles(row.get("role").toString())
        .disabled(hash == null || !hash.matches("[0-9a-f]{96}"))
        .build();
  }

  public Map<String, Object> view(Principal principal) {
    var row = account(principal.getName());
    row.remove("password_hash");
    return row;
  }
}
