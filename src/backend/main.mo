import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Array "mo:core/Array";
import Char "mo:core/Char";
import Iter "mo:core/Iter";
import Runtime "mo:core/Runtime";

actor {
  type User = {
    name : Text;
    level : Nat;
    question : Text;
    answer : Text;
    uid : Text;
  };

  var nextId = 10000;
  let users = Map.empty<Text, User>();

  public query ({ caller }) func userExists(name : Text) : async Bool {
    users.containsKey(name);
  };

  public query ({ caller }) func getAllUsers() : async [(Text, Nat)] {
    users.toArray().map(func((name, user)) { (name, user.level) });
  };

  public query ({ caller }) func getSecurityQuestion(name : Text) : async Text {
    switch (users.get(name)) {
      case (null) { Runtime.trap("Could not find user.") };
      case (?user) { user.question };
    };
  };

  public query ({ caller }) func loginUser(name : Text, answer : Text) : async User {
    switch (users.get(name)) {
      case (null) { Runtime.trap("Login failed. User with this name does not exist.") };
      case (?user) {
        let nameNormalized = Text.fromIter(
          name.toIter().map(
            func(c) {
              if (c.isAlphabetic() and c >= 'a' and c <= 'z') {
                Char.fromNat32(c.toNat32() - 32);
              } else { c };
            }
          )
        );

        let answerNormalized = Text.fromIter(
          answer.toIter().map(
            func(c) {
              if (c.isAlphabetic() and c >= 'A' and c <= 'Z') {
                Char.fromNat32(c.toNat32() + 32);
              } else { c };
            }
          )
        );

        if (answerNormalized != user.answer) {
          Runtime.trap("Login failed. User recognized but security answer incorrect.");
        };

        if (nameNormalized != user.name) {
          Runtime.trap("Please use uppercase for your user name. Login passed but in an insecure way.");
        };

        user;
      };
    };
  };

  public query ({ caller }) func getUserCount() : async Nat {
    users.size();
  };

  public shared ({ caller }) func registerUser(name : Text, question : Text, answer : Text) : async () {
    let normalizedUser = Text.fromIter(
      name.toIter().map(
        func(c) {
          if (c.isAlphabetic() and c >= 'a' and c <= 'z') {
            Char.fromNat32(c.toNat32() - 32);
          } else { c };
        }
      )
    );

    let normalizedAnswer = Text.fromIter(
      answer.toIter().map(
        func(c) {
          if (c.isAlphabetic() and c >= 'A' and c <= 'Z') {
            Char.fromNat32(c.toNat32() + 32);
          } else { c };
        }
      )
    );

    let newUser : User = {
      name = normalizedUser;
      level = 1;
      question;
      answer = normalizedAnswer;
      uid = nextId.toText();
    };

    if (users.containsKey(newUser.name)) {
      Runtime.trap("User name " # newUser.name # " is already taken, please use a different name!");
    };

    users.add(newUser.name, newUser);
    nextId += 1;
  };

  public shared ({ caller }) func updateUserLevel(name : Text, newLevel : Nat) : async () {
    if (newLevel < 1 or newLevel > 7) {
      Runtime.trap("Invalid user level: can only be between 1 and 7.");
    };

    switch (users.get(name)) {
      case (null) { Runtime.trap("Could not update user level: user does not exist.") };
      case (?user) {
        let updatedUser = { user with level = newLevel };
        users.add(name, updatedUser);
      };
    };
  };

  public shared ({ caller }) func deleteUser(name : Text) : async () {
    let nameNormalized = Text.fromIter(
      name.toIter().map(
        func(c) {
          if (c.isAlphabetic() and c >= 'a' and c <= 'z') {
            Char.fromNat32(c.toNat32() - 32);
          } else { c };
        }
      )
    );

    switch (users.get(nameNormalized)) {
      case (null) { Runtime.trap("Could not delete user: user does not exist.") };
      case (?_) { users.remove(nameNormalized) };
    };
  };
};
